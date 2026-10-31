// The pacing sim tests: whole waves played for several seeds, as a player
// who kills every zombie the moment it walks in. They take seconds, so they
// run in `bun run test:full` and CI, not in `bun run test`. The pacing rules
// themselves are in pacing.story.test.ts.
import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR, nearestDoor } from './arena'
import { doorCounts, rollWave } from './endlessWaves'
import { update } from './main'
import { Message } from './message'
import {
  Alarm,
  type DoorId,
  type Model,
  Phase,
  type PlannedSpawn,
  calmPacing,
  initialModel,
} from './model'
import { asVeteran } from './veteran'
import { FINAL_WAVE } from './wavePlans'

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

// NOTE: This plays a wave as a player who kills every zombie the moment it
// walks in, the worst case for an empty room. A frame is quiet when the room
// is empty and no warned pack waits at a door. The player has met every kind,
// so a new zombie intro does not hold the wave clock.
const playKillingEverything = (wave: number, seed: number): Played => {
  const [rngState, rolled] = rollWave(seed, wave)
  const preparing = modifyFields(asVeteran(initialModel), {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 5000,
        durationMs: 5000,
        spawns: rolled.spawns,
      }),
    pacing: () => modifyFields(calmPacing, { holds: () => rolled.holds }),
    rngState: () => rngState,
  })
  const started = update(preparing, Message.PressedKey({ code: 'Enter' })).model
  const seen = new Map<number, Arrival>()
  const quietFrames: Array<boolean> = []
  Array.reduce(
    Array.makeBy(6000, index => index + 1),
    started,
    (current, frame) => {
      if (!Phase.guards.Wave(current.phase)) {
        return current
      }
      const next = update(
        current,
        Message.TickedFrame({ deltaTime: FRAME_MS }),
      ).model
      Array.forEach(next.zombies, zombie => {
        if (!seen.has(zombie.id)) {
          seen.set(zombie.id, {
            kind: zombie.kind,
            door: nearestDoor(PARLOUR, zombie).id,
            atMs: frame * FRAME_MS,
          })
        }
      })
      if (Phase.guards.Wave(next.phase)) {
        quietFrames.push(
          Array.isReadonlyArrayEmpty(next.zombies) && !isAnnounced(next),
        )
      }
      return modifyFields(next, { zombies: () => [] })
    },
  )
  return {
    spawns: rolled.spawns,
    arrivals: Array.fromIterable(seen.values()),
    quietFrames,
  }
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
  test('the preview matches every zombie that comes out of each door', () => {
    Array.forEach([4, 6, FINAL_WAVE, FINAL_WAVE + 2], wave => {
      expectPreviewMatches(playKillingEverything(wave, 2468))
    })
  })

  test('replaying the same seed and Messages gives the same spawns in the same order', () => {
    const first = playKillingEverything(6, 777)
    const second = playKillingEverything(6, 777)
    expect(second).toEqual(first)
  })
})

describe('dead air', () => {
  const DEAD_AIR_MAX_MS = 1000
  const SEEDS = Array.makeBy(12, index => 1 + index * 7919)

  test("wave 2's first pack walks in within 2 seconds of the wave starting", () => {
    Array.forEach(SEEDS, seed => {
      const { arrivals } = playKillingEverything(2, seed)
      const firstMs = Math.min(...Array.map(arrivals, ({ atMs }) => atMs))
      expect(firstMs).toBeLessThanOrEqual(2000)
    })
  })

  test('no wave leaves the room empty and unannounced for more than a second', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE + 2, index => index + 1),
      wave => {
        Array.forEach(Array.take(SEEDS, wave > FINAL_WAVE ? 1 : 5), seed => {
          const { quietFrames } = playKillingEverything(wave, seed)
          expect(longestQuietMs(quietFrames)).toBeLessThanOrEqual(
            DEAD_AIR_MAX_MS,
          )
        })
      },
    )
    // NOTE: about 40 s on CI's runner beside the other sims, and up to 85 s
    // when it shares the runner with the busiest of them.
  }, 150_000)
})

describe('spawn variety', () => {
  test('the preview matches every zombie on every campaign wave for several seeds', () => {
    Array.forEach(
      Array.makeBy(FINAL_WAVE, index => index + 1),
      wave => {
        Array.forEach([11, 4242], seed => {
          expectPreviewMatches(playKillingEverything(wave, seed))
        })
      },
    )
  }, 90_000)
})
