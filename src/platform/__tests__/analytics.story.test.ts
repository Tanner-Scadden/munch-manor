import { Effect, Option, Schema } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { afterEach, describe, expect, it, test, vi } from '@effect/vitest'
import { MAX_PLAYERS } from '@munch/netcode'

import { ProfileBinding } from '../../app/bindings'
import { GenerateVisitId } from '../../app/boot'
import { Message } from '../../app/message'
import {
  Frenzy,
  HomeMode,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  ZombieKind,
  ZombieState,
  freshStats,
  noKills,
} from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { WriteSave } from '../../app/update/save'
import { SendRunSummary } from '../../app/update/settle'
import { Message as ProfileMessage } from '../../features/profile/message'
import { InputDevice } from '../../input/inputSchema'
import { FIXED_STEP_MS, ZOMBIE_MAX_HP } from '../../shared/constants'
import {
  APPLICATION,
  SURFACE,
  bootWithoutVisitId,
  closeDialog,
  jsonOf,
  showDialog,
  writeSave,
} from '../../test/testing'
import {
  DISTANT_SPAWN,
  escaping,
  withDareThings,
} from '../../test/model.fixture'
import { asVeteran } from '../../test/veteran'
import { DareThingState } from '../../world/dare/dareSchema'
import { START_LEVEL } from '../../world/level/arena'
import { modifyFocus } from '../../world/party/party'
import { type Modifiers, noModifiers } from '../../world/run/modifiers'
import { FINAL_WAVE } from '../../world/waves/wavePlans'
import { pause } from '../../world/waves/waves'
import {
  CauseOfDeath,
  MAX_CREW_SIZE,
  MAX_SUMMARY_BYTES,
  PostedRunJson,
  type RunSummary,
  RunSummaryJson,
  SOLO_PARTY,
  SummaryDevice,
  SummaryKind,
  SummaryMode,
} from '../analytics'
import {
  generateVisitId,
  maybeRunsUrl,
  sendRunSummary,
} from '../analyticsBeacon'
import { frameTimeBucket } from '../analyticsRun'
import { PlayerChange } from '../playerSync'
import { saveOf } from '../save'

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

const lastHeart: Model = modifyFocus(
  modifyFields(midRun, {
    zombies: () => [runnerAt(START_LEVEL.start.x + 2, START_LEVEL.start.y)],
  }),
  { player: player => modifyFields(player, { hp: () => 1 }) },
)

// NOTE: the tenth wave with the front door open and the player on its
// sill: the next frame walks out.
const finalWave: Model = escaping(
  modifyFields(midRun, {
    phase: () =>
      Phase.Wave({
        wave: FINAL_WAVE,
        elapsedMs: 90_000,
        spawns: [DISTANT_SPAWN],
      }),
  }),
)

const FRAME_MS = FIXED_STEP_MS

const expectedSummary = (
  overrides: Partial<RunSummary> & Pick<RunSummary, 'outcome' | 'wave'>,
): RunSummary => ({
  version: 5,
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
  party: SOLO_PARTY,
  modifiers: 0,
  dareItemsFound: 0,
  ...overrides,
})

const CREW_KEY = '0123456789abcdef'

const CREW_V2 = {
  _tag: 'Crew',
  size: 2,
  seatKills: 5,
  seatDowns: 1,
  seatRevives: 0,
} as const

const CREW = { ...CREW_V2, runKey: CREW_KEY }

describe('the run summary schema', () => {
  const summary = expectedSummary({
    outcome: { _tag: 'GameOver', killedBy: 'Runner' },
    wave: 4,
  })

  test('a summary round trips through JSON and fits the size cap', () => {
    const json = Option.getOrThrow(Schema.encodeOption(RunSummaryJson)(summary))
    expect(Schema.decodeOption(RunSummaryJson)(json)).toEqual(
      Option.some(summary),
    )
    expect(new Blob([json]).size).toBeLessThan(MAX_SUMMARY_BYTES)
  })

  test('bad fields are refused', () => {
    const decode = Schema.decodeUnknownOption(RunSummaryJson)
    const withField = (field: string, value: unknown): string =>
      jsonOf({ ...summary, [field]: value })
    expect(decode(withField('wave', -1))).toEqual(Option.none())
    expect(decode(withField('runMs', 1.5))).toEqual(Option.none())
    expect(decode(withField('visitId', 'not-a-visit'))).toEqual(Option.none())
    expect(decode(withField('difficulty', 'Impossible'))).toEqual(Option.none())
    expect(
      decode(withField('outcome', { _tag: 'GameOver', killedBy: 'Ghost' })),
    ).toEqual(Option.none())
    expect(decode(withField('version', 6))).toEqual(Option.none())
    expect(decode(withField('version', 4))).toEqual(Option.none())
    expect(decode(withField('outcome', { _tag: 'Victory' }))).toEqual(
      Option.none(),
    )
    expect(decode(withField('dareItemsFound', -1))).toEqual(Option.none())
    expect(decode(withField('modifiers', 16))).toEqual(Option.none())
    expect(decode(withField('modifiers', -1))).toEqual(Option.none())
    expect(decode(withField('modifiers', 1.5))).toEqual(Option.none())
    expect(
      decode(
        withField('party', {
          _tag: 'Crew',
          size: MAX_CREW_SIZE + 1,
          seatKills: 0,
          seatDowns: 0,
          seatRevives: 0,
          runKey: CREW_KEY,
        }),
      ),
    ).toEqual(Option.none())
    expect(
      decode(withField('party', { ...CREW, runKey: 'not-a-key' })),
    ).toEqual(Option.none())
    expect(decode(withField('party', CREW_V2))).toEqual(Option.none())
    expect(decode('{"version":1,')).toEqual(Option.none())
  })

  test('a crew summary round trips with its run key', () => {
    const crew = { ...summary, party: CREW }
    const json = Option.getOrThrow(Schema.encodeOption(RunSummaryJson)(crew))
    expect(Schema.decodeOption(RunSummaryJson)(json)).toEqual(Option.some(crew))
  })

  test('a version 4 summary from a cached build still decodes, its win a Victory', () => {
    const { dareItemsFound: _found, ...older } = summary
    const json = jsonOf({ ...older, version: 4, outcome: { _tag: 'Victory' } })
    expect(Schema.decodeOption(PostedRunJson)(json)).toEqual(
      Option.some({ ...older, version: 4, outcome: { _tag: 'Victory' } }),
    )
    expect(Schema.decodeOption(RunSummaryJson)(json)).toEqual(Option.none())
  })

  test('a version 3 summary from a cached build still decodes, with no modifiers', () => {
    const {
      modifiers: _modifiers,
      dareItemsFound: _found,
      ...older
    } = summary
    const json = jsonOf({ ...older, version: 3 })
    expect(Schema.decodeOption(PostedRunJson)(json)).toEqual(
      Option.some({
        ...older,
        version: 3,
      }),
    )
    expect(Schema.decodeOption(RunSummaryJson)(json)).toEqual(Option.none())
  })

  test('a version 2 crew summary from a cached build still decodes, with no key', () => {
    const {
      modifiers: _modifiers,
      dareItemsFound: _found,
      ...older
    } = summary
    const json = jsonOf({ ...older, version: 2, party: CREW_V2 })
    expect(Schema.decodeOption(PostedRunJson)(json)).toEqual(
      Option.some({
        ...older,
        version: 2,
        party: CREW_V2,
      }),
    )
    expect(Schema.decodeOption(RunSummaryJson)(json)).toEqual(Option.none())
  })

  test('a version 1 summary from a cached build still decodes, with no party', () => {
    const {
      party: _party,
      modifiers: _modifiers,
      dareItemsFound: _found,
      ...older
    } = summary
    const json = jsonOf({ ...older, version: 1 })
    expect(Schema.decodeOption(PostedRunJson)(json)).toEqual(
      Option.some({
        ...older,
        version: 1,
      }),
    )
    expect(Schema.decodeOption(RunSummaryJson)(json)).toEqual(Option.none())
  })

  test("the shared literals still match the game's own", () => {
    expect(SummaryKind.literals).toEqual(ZombieKind.literals)
    expect(CauseOfDeath.literals).toEqual([...ZombieKind.literals, 'Unknown'])
    expect(SummaryMode.literals).toEqual(HomeMode.literals)
    expect(SummaryDevice.literals).toEqual(InputDevice.literals)
    expect(MAX_CREW_SIZE).toBe(MAX_PLAYERS)
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
  const lostWith = (modifiers: Modifiers): Model =>
    modifyFields(lastHeart, { modifiers: () => modifiers })

  it.effect('the modifiers that were on go in the summary as a mask', () =>
    Story.story(
      APPLICATION,
      Story.given(lostWith({ ...noModifiers, glass: true, broke: true })),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'GameOver', killedBy: 'Runner' },
            wave: 4,
            heartsLost: 3,
            frameTime: 'Under17Ms',
            modifiers: 12,
          }),
        }),
      ),
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    ),
  )

  it.effect('Friendly Fire with no teammate to hit is not counted', () =>
    Story.story(
      APPLICATION,
      Story.given(
        lostWith({ ...noModifiers, friendlyFire: true, bigCrowd: true }),
      ),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'GameOver', killedBy: 'Runner' },
            wave: 4,
            heartsLost: 3,
            frameTime: 'Under17Ms',
            modifiers: 2,
          }),
        }),
      ),
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    ),
  )

  it.effect('Game Over sends the run with what killed the player', () =>
    Story.story(
      APPLICATION,
      Story.given(lastHeart),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
      Story.Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'GameOver', killedBy: 'Runner' },
            wave: 4,
            heartsLost: 3,
            frameTime: 'Under17Ms',
          }),
        }),
      ),
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    ),
  )

  it.effect('an escape sends the won run at its wave', () =>
    Story.story(
      APPLICATION,
      Story.given(finalWave),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.model(({ phase }) => {
        expect(phase).toEqual(Phase.Escaped({ wave: 10 }))
      }),
      Story.Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'Escaped' },
            wave: FINAL_WAVE,
          }),
        }),
      ),
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    ),
  )

  it.effect('an escape counts the things on the list it found', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withDareThings(finalWave, [
          {
            id: 0,
            kind: 'SilverSpoon',
            isAsked: true,
            state: DareThingState.Found({ slot: 0 }),
          },
          {
            id: 1,
            kind: 'MusicBox',
            isAsked: true,
            state: DareThingState.Found({ slot: 0 }),
          },
          {
            id: 2,
            kind: 'ButlersBell',
            isAsked: false,
            state: DareThingState.Held({ slot: 0 }),
          },
        ]),
      ),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.Command.expectHas(
        SendRunSummary({
          summary: expectedSummary({
            outcome: { _tag: 'Escaped' },
            wave: FINAL_WAVE,
            dareItemsFound: 2,
          }),
        }),
      ),
      Story.Command.resolve(SendRunSummary, Message.CompletedSendRunSummary()),
    ),
  )

  it.effect(
    'leaving from the pause MENU sends the run as a Quit, read before it resets',
    () =>
      Story.story(
        APPLICATION,
        Story.given(pause(midRun)),
        Story.message(Message.PressedKey({ code: 'KeyH' })),
        showDialog(),
        Story.message(Message.ClickedLeaveRunButton()),
        closeDialog(),
        Story.model(({ phase, stats }) => {
          expect(Phase.guards.Ready(phase)).toBe(true)
          expect(stats).toEqual(freshStats)
        }),
        Story.Command.expectHas(
          SendRunSummary({
            summary: expectedSummary({
              outcome: { _tag: 'Quit' },
              wave: 4,
              runMs: 200_000,
              device: 'KeyboardMouse',
            }),
          }),
        ),
        Story.Command.resolve(
          SendRunSummary,
          Message.CompletedSendRunSummary(),
        ),
      ),
  )

  it.effect('a failed send changes nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(lastHeart),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.Command.resolve(
        SendRunSummary,
        Message.FailedSendRunSummary({ reason: 'offline' }),
      ),
      Story.model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
    ),
  )

  it.effect(
    'nothing is sent with sharing off, or before the visit has an id',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(modifyFields(lastHeart, { shareStats: () => 'Off' })),
          Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
          Story.model(({ phase }) => {
            expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
          }),
          Story.Command.expectNone(),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(finalWave, { maybeVisitId: () => Option.none() }),
          ),
          Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
          Story.model(({ phase }) => {
            expect(phase).toEqual(Phase.Escaped({ wave: 10 }))
          }),
          Story.Command.expectNone(),
        )
      }),
  )

  it.effect('a frame mid-wave sends nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(midRun),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.Command.expectNone(),
    ),
  )
})

describe('the sharing setting', () => {
  it.effect('the toggle turns sharing off and saves it', () => {
    const saved = modifyFields(home, { saveStatus: () => 'Read' })
    const off = modifyFields(saved, { shareStats: () => 'Off' })
    return Story.story(
      APPLICATION,
      Story.given(saved),
      Story.messageIn(
        ProfileBinding,
        ProfileMessage.ClickedSettingTile({ setting: 'ShareStats' }),
      ),
      Story.model(({ shareStats }) => {
        expect(shareStats).toBe('Off')
      }),
      Story.Command.expectExact(
        WriteSave({
          save: saveOf(off),
          changes: [
            PlayerChange.ChangedSettings({ settings: saveOf(off).settings }),
          ],
        }),
      ),
      writeSave(),
    )
  })

  it.effect('the visit id comes from a Command at start', () =>
    Story.story(
      APPLICATION,
      Story.init(),
      Story.model(({ maybeVisitId }) => {
        expect(maybeVisitId).toEqual(Option.none())
      }),
      Story.Command.expectHas(GenerateVisitId()),
      Story.Command.resolve(
        GenerateVisitId(),
        Message.CompletedGenerateVisitId({ visitId: VISIT_ID }),
      ),
      Story.model(({ maybeVisitId }) => {
        expect(maybeVisitId).toEqual(Option.some(VISIT_ID))
      }),
      bootWithoutVisitId,
    ),
  )
})

describe('the beacon', () => {
  const summary = expectedSummary({
    outcome: { _tag: 'Escaped' },
    wave: FINAL_WAVE,
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect('a visit id is 16 hex digits', () =>
    Effect.gen(function* () {
      const generateVisitId_1 = yield* generateVisitId
      expect(generateVisitId_1).toMatch(/^[0-9a-f]{16}$/)
    }),
  )

  it.effect('a build with no API origin sends nothing', () =>
    Effect.gen(function* () {
      expect(maybeRunsUrl('')).toEqual(Option.none())
      const value_1 = yield* sendRunSummary(summary, '')
      expect(value_1).toBe('Unconfigured')
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
