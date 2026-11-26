import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  Alarm,
  BreakClock,
  type DoorId,
  type Model,
  Phase,
  type PlannedSpawn,
  calmPacing,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  changeModel,
  checkModel,
  messageIfAny,
  modelAfter,
  playedThrough,
  settleRunCommands,
  steps,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { PARLOUR } from '../../level/arena'
import { nearestDoor } from '../../level/tileQueries'
import { doorCounts, rollWave } from '../endlessWaves'
import { FINAL_WAVE } from '../wavePlans'

const FRAME_MS = 50

type Arrival = Readonly<{ kind: string; door: DoorId; atMs: number }>

type Played = Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  arrivals: ReadonlyArray<Arrival>
  quietFrames: ReadonlyArray<boolean>
}>

const isAnnounced = (current: Model): boolean =>
  Alarm.guards.Ringing(current.pacing.alarm) ||
  (Phase.guards.Wave(current.phase) &&
    Array.some(current.phase.spawns, ({ pack }) =>
      Array.contains(current.pacing.warnedPacks, pack),
    ))

const WAVE_FRAMES = 6000

const SETTLE_EVERY = 60

const killingFrame = (
  frame: number,
  arrivals: Array<Arrival>,
  quietFrames: Array<boolean>,
) =>
  steps(
    messageIfAny(current =>
      Phase.guards.Wave(current.phase)
        ? Option.some(Message.TickedFrame({ deltaTime: FRAME_MS }))
        : Option.none(),
    ),
    checkModel((current: Model) => {
      arrivals.push(
        ...Array.map(current.zombies, zombie => ({
          kind: zombie.kind,
          door: nearestDoor(PARLOUR, zombie).id,
          atMs: frame * FRAME_MS,
        })),
      )
      if (Phase.guards.Wave(current.phase)) {
        quietFrames.push(
          Array.isReadonlyArrayEmpty(current.zombies) && !isAnnounced(current),
        )
      }
    }),
    changeModel(current => UiStruct.evolve(current, { zombies: () => [] })),
    ...(frame % SETTLE_EVERY === 0 ? [settleRunCommands] : []),
  )

const killEverything = (started: Model) =>
  Effect.suspend(() => {
    const arrivals: Array<Arrival> = []
    const quietFrames: Array<boolean> = []
    return modelAfter(
      started,
      steps(
        ...Array.makeBy(WAVE_FRAMES, index =>
          killingFrame(index + 1, arrivals, quietFrames),
        ),
        settleRunCommands,
      ),
    ).pipe(Effect.as({ arrivals, quietFrames }))
  })

const playKillingEverything = (wave: number, seed: number) => {
  const [rngState, rolled] = rollWave(seed, wave)
  const preparing = UiStruct.evolve(asVeteran(initialModel), {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
        wave,
        remainingMs: 5000,
        durationMs: 5000,
        spawns: rolled.spawns,
      }),
    pacing: () => UiStruct.evolve(calmPacing, { holds: () => rolled.holds }),
    rngState: () => rngState,
  })
  return playedThrough(preparing, [Message.PressedKey({ code: 'Enter' })]).pipe(
    Effect.flatMap(started => killEverything(started)),
    Effect.map((progress): Played => ({ spawns: rolled.spawns, ...progress })),
  )
}

const longestQuietMs = (quietFrames: ReadonlyArray<boolean>): number =>
  Array.reduce(
    quietFrames,
    { run: 0, longest: 0 },
    ({ run, longest }, quiet) => {
      const next = quiet ? run + FRAME_MS : 0
      return { run: next, longest: Math.max(longest, next) }
    },
  ).longest

const expectPreviewMatches = ({ spawns, arrivals }: Played) => {
  expect(arrivals).toHaveLength(spawns.length)
  Array.forEach(doorCounts(spawns, []), ({ door, kinds }) => {
    const atDoor = Array.filter(arrivals, arrival => arrival.door === door)
    expect(
      Array.map(kinds, ({ kind }) => ({
        kind,
        count: Array.filter(atDoor, arrival => arrival.kind === kind).length,
      })),
    ).toEqual(kinds)
  })
}

describe('determinism and the preview', () => {
  it.effect(
    'the preview matches every zombie that comes out of each door',
    () =>
      Effect.forEach([4, 6, FINAL_WAVE, FINAL_WAVE + 2], wave =>
        Effect.map(playKillingEverything(wave, 2468), expectPreviewMatches),
      ),
  )

  it.effect(
    'replaying the same seed and Messages gives the same spawns in the same order',
    () =>
      Effect.gen(function* () {
        const first = yield* playKillingEverything(6, 777)
        const second = yield* playKillingEverything(6, 777)
        expect(second).toEqual(first)
      }),
  )
})

describe('dead air', () => {
  const DEAD_AIR_MAX_MS = 1000
  const SEEDS = Array.makeBy(12, index => 1 + index * 7919)

  it.effect(
    "wave 2's first pack walks in within 2 seconds of the wave starting",
    () =>
      Effect.forEach(SEEDS, seed =>
        Effect.map(playKillingEverything(2, seed), ({ arrivals }) => {
          const firstMs = Math.min(...Array.map(arrivals, ({ atMs }) => atMs))
          expect(firstMs).toBeLessThanOrEqual(2000)
        }),
      ),
  )

  it.effect(
    'no wave leaves the room empty and unannounced for more than a second',
    () =>
      Effect.forEach(
        Array.makeBy(FINAL_WAVE + 2, index => index + 1),
        wave =>
          Effect.forEach(Array.take(SEEDS, wave > FINAL_WAVE ? 1 : 5), seed =>
            Effect.map(playKillingEverything(wave, seed), ({ quietFrames }) => {
              expect(longestQuietMs(quietFrames)).toBeLessThanOrEqual(
                DEAD_AIR_MAX_MS,
              )
            }),
          ),
      ),
    150_000,
  )
})

describe('spawn variety', () => {
  it.effect(
    'the preview matches every zombie on every campaign wave for several seeds',
    () =>
      Effect.forEach(
        Array.makeBy(FINAL_WAVE, index => index + 1),
        wave =>
          Effect.forEach([11, 4242], seed =>
            Effect.map(playKillingEverything(wave, seed), expectPreviewMatches),
          ),
      ),
    90_000,
  )
})
