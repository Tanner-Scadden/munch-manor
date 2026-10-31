import { Effect, Option, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, test, vi } from '@effect/vitest'

import {
  CauseOfDeath,
  MAX_SUMMARY_BYTES,
  type RunSummary,
  RunSummaryJson,
  SummaryDevice,
  SummaryKind,
  SummaryMode,
} from './analytics'
import {
  generateVisitId,
  maybeRunsUrl,
  sendRunSummary,
} from './analyticsBeacon'
import { frameTimeBucket } from './analyticsRun'
import { PARLOUR } from './arena'
import { GenerateVisitId } from './boot'
import { FIXED_STEP_MS, ZOMBIE_MAX_HP } from './constants'
import { init, update } from './main'
import { Message } from './message'
import {
  Frenzy,
  HomeMode,
  InputDevice,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  ZombieKind,
  ZombieState,
  freshStats,
  initialModel,
  noKills,
} from './model'
import { PlayerChange } from './playerSync'
import { saveOf } from './save'
import { SURFACE, closeDialog, showDialog } from './testing'
import { WriteSave } from './update/save'
import { SendRunSummary } from './update/settle'
import { asVeteran } from './veteran'
import { FINAL_WAVE } from './wavePlans'
import { pause } from './waves'

const VISIT_ID = '0123456789abcdef'

const home: Model = modifyFields(asVeteran(initialModel), {
  maybeSurface: () => Option.some(SURFACE),
  maybeVisitId: () => Option.some(VISIT_ID),
})

const runnerAt = (x: number, y: number): Zombie => ({
  id: 100,
  kind: 'Runner',
  x,
  y,
  speed: 0,
  hp: ZOMBIE_MAX_HP,
  maxHp: ZOMBIE_MAX_HP,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const midRun: Model = modifyFields(home, {
  phase: () => Phase.Wave({ wave: 4, elapsedMs: 4000, spawns: [] }),
  difficulty: setting => modifyFields(setting, { chosen: () => 'Hard' }),
  lastDevice: () => 'Touch',
  screenFit: () => 'Installed',
  stats: () =>
    modifyFields(freshStats, {
      kills: () =>
        modifyFields(noKills, { Shambler: () => 30, Runner: () => 4 }),
      heartsLost: () => 2,
      purchases: () => 3,
      powerUpsGrabbed: () => 1,
      trapsPlaced: () => 2,
      activeFrames: () => 1000,
      activeFrameMs: () => 16_000,
      runMs: () => 200_000,
    }),
})

const lastHeart: Model = modifyFields(midRun, {
  player: player => modifyFields(player, { hp: () => 1 }),
  zombies: () => [runnerAt(PARLOUR.width / 2 + 2, PARLOUR.height / 2)],
})

const finalWave: Model = modifyFields(midRun, {
  phase: () => Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 90_000, spawns: [] }),
})

const FRAME_MS = FIXED_STEP_MS

const expectedSummary = (
  overrides: Partial<RunSummary> & Pick<RunSummary, 'outcome' | 'wave'>,
): RunSummary => ({
  version: 1,
  visitId: VISIT_ID,
  build: 'test',
  mode: 'Campaign',
  difficulty: 'Hard',
  runMs: Math.round(200_000 + FRAME_MS),
  kills: modifyFields(noKills, { Shambler: () => 30, Runner: () => 4 }),
  heartsLost: 2,
  purchases: 3,
  powerUpsGrabbed: 1,
  trapsPlaced: 2,
  device: 'Touch',
  screenFit: 'Installed',
  frameTime: 'Under17Ms',
  ...overrides,
})

describe('the run summary schema', () => {
  const summary = expectedSummary({
    outcome: { _tag: 'GameOver', killedBy: 'Runner' },
    wave: 4,
  })

  test('a summary round trips through JSON and fits the size cap', () => {
    const json = Schema.encodeSync(RunSummaryJson)(summary)
    expect(Schema.decodeSync(RunSummaryJson)(json)).toEqual(summary)
    expect(new Blob([json]).size).toBeLessThan(MAX_SUMMARY_BYTES)
  })

  test('bad fields are refused', () => {
    const decode = Schema.decodeUnknownOption(RunSummaryJson)
    const withField = (field: string, value: unknown): string =>
      JSON.stringify({ ...summary, [field]: value })
    expect(decode(withField('wave', -1))).toEqual(Option.none())
    expect(decode(withField('runMs', 1.5))).toEqual(Option.none())
    expect(decode(withField('visitId', 'not-a-visit'))).toEqual(Option.none())
    expect(decode(withField('difficulty', 'Impossible'))).toEqual(Option.none())
    expect(
      decode(withField('outcome', { _tag: 'GameOver', killedBy: 'Ghost' })),
    ).toEqual(Option.none())
    expect(decode(withField('version', 2))).toEqual(Option.none())
    expect(decode('{"version":1,')).toEqual(Option.none())
  })

  test("the shared literals still match the game's own", () => {
    expect(SummaryKind.literals).toEqual(ZombieKind.literals)
    expect(CauseOfDeath.literals).toEqual([...ZombieKind.literals, 'Unknown'])
    expect(SummaryMode.literals).toEqual(HomeMode.literals)
    expect(SummaryDevice.literals).toEqual(InputDevice.literals)
  })

  test('the frame time lands in a bucket by its average', () => {
    const at = (activeFrames: number, activeFrameMs: number) =>
      frameTimeBucket(
        modifyFields(freshStats, {
          activeFrames: () => activeFrames,
          activeFrameMs: () => activeFrameMs,
        }),
      )
    expect(at(0, 0)).toBe('Unmeasured')
    expect(at(10, 83)).toBe('Under10Ms')
    expect(at(10, 166)).toBe('Under17Ms')
    expect(at(10, 240)).toBe('Under25Ms')
    expect(at(10, 333)).toBe('Under34Ms')
    expect(at(10, 500)).toBe('Over34Ms')
  })
})

describe('sending at the end of a run', () => {
  test('Game Over sends the run with what killed the player', () => {
    story(
      update,
      given(lastHeart),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
      Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'GameOver', killedBy: 'Runner' },
            wave: 4,
            heartsLost: 3,
            frameTime: 'Under17Ms',
          }),
        }),
      ),
      Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    )
  })

  test('Victory sends the won run at the final wave', () => {
    story(
      update,
      given(finalWave),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'Victory' },
            wave: FINAL_WAVE,
          }),
        }),
      ),
      Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    )
  })

  test('leaving from the pause MENU sends the run as a Quit, read before it resets', () => {
    story(
      update,
      given(pause(midRun)),
      message(Message.PressedKey({ code: 'KeyH' })),
      showDialog(),
      message(Message.ClickedLeaveRunButton()),
      closeDialog(),
      model(({ phase, stats }) => {
        expect(Phase.guards.Ready(phase)).toBe(true)
        expect(stats).toEqual(freshStats)
      }),
      Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'Quit' },
            wave: 4,
            runMs: 200_000,
            device: 'KeyboardMouse',
          }),
        }),
      ),
      Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    )
  })

  test('a failed send changes nothing', () => {
    story(
      update,
      given(lastHeart),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Command.resolve(
        SendRunSummary,
        Message.FailedSendRunSummary({ reason: 'offline' }),
      ),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
    )
  })

  test('nothing is sent with sharing off, or before the visit has an id', () => {
    story(
      update,
      given(modifyFields(lastHeart, { shareStats: () => 'Off' })),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
      Command.expectNone(),
    )
    story(
      update,
      given(modifyFields(finalWave, { maybeVisitId: () => Option.none() })),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      Command.expectNone(),
    )
  })

  test('a frame mid-wave sends nothing', () => {
    story(
      update,
      given(midRun),
      message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Command.expectNone(),
    )
  })
})

describe('the sharing setting', () => {
  test('the toggle turns sharing off and saves it', () => {
    const saved = modifyFields(home, { saveStatus: () => 'Read' })
    const off = modifyFields(saved, { shareStats: () => 'Off' })
    story(
      update,
      given(saved),
      message(Message.ClickedShareStatsButton()),
      model(({ shareStats }) => {
        expect(shareStats).toBe('Off')
      }),
      Command.expectExact(
        WriteSave({
          save: saveOf(off),
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(off).settings }),
          ],
        }),
      ),
      Command.resolve(WriteSave, Message.CompletedWriteSave()),
    )
  })

  test('the visit id comes from a Command at start', () => {
    expect((init().commands ?? []).map(command => command.name)).toContain(
      GenerateVisitId().name,
    )
    story(
      update,
      given(modifyFields(home, { maybeVisitId: () => Option.none() })),
      message(Message.CompletedGenerateVisitId({ visitId: VISIT_ID })),
      model(({ maybeVisitId }) => {
        expect(maybeVisitId).toEqual(Option.some(VISIT_ID))
      }),
    )
  })
})

describe('the beacon', () => {
  const summary = expectedSummary({
    outcome: { _tag: 'Victory' },
    wave: FINAL_WAVE,
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect('a visit id is 16 hex digits', () =>
    Effect.gen(function* () {
      expect(yield* generateVisitId).toMatch(/^[0-9a-f]{16}$/)
    }),
  )

  it.effect('a build with no API origin sends nothing', () =>
    Effect.gen(function* () {
      expect(maybeRunsUrl('')).toEqual(Option.none())
      expect(yield* sendRunSummary(summary, '')).toBe('Unconfigured')
    }),
  )

  it.effect('the summary goes out as a beacon to the runs path', () =>
    Effect.gen(function* () {
      const sendBeacon = vi.fn<Navigator['sendBeacon']>(() => true)
      vi.stubGlobal('navigator', { sendBeacon })
      const transport = yield* sendRunSummary(
        summary,
        'https://api.example.test',
      )
      expect(transport).toBe('Beacon')
      expect(sendBeacon).toHaveBeenCalledWith(
        'https://api.example.test/api/runs',
        expect.any(Blob),
      )
    }),
  )

  it.effect('a refused beacon falls back to a keepalive fetch', () =>
    Effect.gen(function* () {
      const requests: Array<{ url: string; init: RequestInit | undefined }> = []
      const fetch: typeof globalThis.fetch = (input, requestInit) => {
        requests.push({
          url: input instanceof Request ? input.url : String(input),
          init: requestInit,
        })
        return Promise.resolve(new Response(null))
      }
      vi.stubGlobal('navigator', { sendBeacon: () => false })
      const transport = yield* sendRunSummary(
        summary,
        'https://api.example.test',
      ).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch))
      expect(transport).toBe('Fetch')
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe('https://api.example.test/api/runs')
      expect(requests[0]?.init).toEqual(
        expect.objectContaining({
          keepalive: true,
          method: 'POST',
          mode: 'no-cors',
          credentials: 'omit',
        }),
      )
      expect(new Headers(requests[0]?.init?.headers).get('content-type')).toBe(
        'text/plain;charset=UTF-8',
      )
      expect(new Headers(requests[0]?.init?.headers).has('traceparent')).toBe(
        false,
      )
    }),
  )

  it.effect('a keepalive fetch that never goes out is a failed send', () =>
    Effect.gen(function* () {
      const fetch: typeof globalThis.fetch = () =>
        Promise.reject(new TypeError('Failed to fetch'))
      vi.stubGlobal('navigator', { sendBeacon: () => false })
      const exit = yield* Effect.exit(
        sendRunSummary(summary, 'https://api.example.test').pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
      )
      expect(exit._tag).toBe('Failure')
    }),
  )
})
