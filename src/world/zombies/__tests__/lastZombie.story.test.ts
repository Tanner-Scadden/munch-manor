import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, type Zombie } from '../../../app/model'
import { FIXED_STEP_MS, PLAYER_SPEED } from '../../../shared/constants'
import { DISTANT_SPAWN, quietWave } from '../../../test/model.fixture'
import { APPLICATION, ticks, zombieAt } from '../../../test/testing'
import { Finale } from '../../dare/dareSchema'
import { START_LEVEL } from '../../level/arena'
import { modifyFocus } from '../../party/party'
import { BossMove, type PlannedSpawn } from '../../schema/worldSchema'
import { LAST_ZOMBIE_RULES, lastZombieSpeed } from '../lastZombie'
import { bossAt, fightingBoss } from './boss.fixture'

const FRAME_MS = FIXED_STEP_MS
const SLOW = 12
const DELAY_TICKS = Math.ceil(LAST_ZOMBIE_RULES.delayMs / FRAME_MS)
const RAMP_TICKS = Math.ceil(
  (LAST_ZOMBIE_RULES.delayMs + LAST_ZOMBIE_RULES.rampMs) / FRAME_MS,
)
const DELAY = LAST_ZOMBIE_RULES.delayMs

// NOTE: the player stands on the start spot and the zombies far to its
// left, on open floor, so each walks straight at the player for seconds.
const FAR_X = START_LEVEL.start.x - 150
const PLAYER_Y = START_LEVEL.start.y

const lastStanding = (
  zombies: ReadonlyArray<Zombie>,
  spawns: ReadonlyArray<PlannedSpawn> = [],
): Model =>
  modifyFocus(
    modifyFields(quietWave(3), {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns }),
      zombies: () => zombies,
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => START_LEVEL.start.x,
          y: () => PLAYER_Y,
        }),
    },
  )

const straggler = zombieAt(1, FAR_X, PLAYER_Y, { speed: SLOW })

const zombieById = (model: Model, id: number): Zombie =>
  Option.getOrThrow(Array.findFirst(model.zombies, zombie => zombie.id === id))

// NOTE: how far the zombie walks over the next few frames, per second.
const paceOver = (start: Model, id: number) =>
  Effect.gen(function* () {
    const before = yield* Story.story(APPLICATION, Story.given(start))
    const after = yield* Story.story(
      APPLICATION,
      Story.given(before),
      ...ticks(6, FRAME_MS),
    )
    const from = zombieById(before, id)
    const to = zombieById(after, id)
    return Math.hypot(to.x - from.x, to.y - from.y) / ((6 * FRAME_MS) / 1000)
  })

const after = (start: Model, count: number) =>
  Story.story(APPLICATION, Story.given(start), ...ticks(count, FRAME_MS))

describe('the last zombies', () => {
  it('wait out the delay, then ramp from their own speed to the players walk, never down', () => {
    expect(lastZombieSpeed(SLOW, 0)).toBe(SLOW)
    expect(lastZombieSpeed(SLOW, DELAY)).toBe(SLOW)
    expect(
      lastZombieSpeed(SLOW, DELAY + LAST_ZOMBIE_RULES.rampMs / 2),
    ).toBeCloseTo((SLOW + PLAYER_SPEED) / 2)
    expect(lastZombieSpeed(SLOW, DELAY + LAST_ZOMBIE_RULES.rampMs)).toBe(
      PLAYER_SPEED,
    )
    expect(lastZombieSpeed(SLOW, DELAY + 10 * LAST_ZOMBIE_RULES.rampMs)).toBe(
      PLAYER_SPEED,
    )
    expect(lastZombieSpeed(90, DELAY + LAST_ZOMBIE_RULES.rampMs)).toBe(90)
  })

  it.effect('a lone last zombie keeps its own pace through the delay', () =>
    Effect.gen(function* () {
      const start = lastStanding([straggler])
      const waited = yield* after(start, DELAY_TICKS - 6)
      expect(waited.pacing.loneMs).toBeGreaterThan(0)
      const pace = yield* paceOver(waited, 1)
      expect(pace).toBeLessThan(SLOW * 2)
    }),
  )

  it.effect(
    'a lone last zombie speeds up to the players walk after the delay',
    () =>
      Effect.gen(function* () {
        const start = lastStanding([straggler])
        const early = yield* paceOver(start, 1)
        expect(early).toBeLessThan(SLOW * 2)

        const ramped = yield* after(start, RAMP_TICKS)
        expect(ramped.pacing.loneMs).toBeGreaterThanOrEqual(
          DELAY + LAST_ZOMBIE_RULES.rampMs,
        )
        expect(zombieById(ramped, 1).speed).toBe(SLOW)
        const late = yield* paceOver(ramped, 1)
        expect(late).toBeGreaterThan(PLAYER_SPEED - 2)
        expect(late).toBeLessThan(PLAYER_SPEED + 0.01)
      }),
  )

  it.effect('it does not hurry while spawns are still to come', () =>
    Effect.gen(function* () {
      const start = lastStanding([straggler], [DISTANT_SPAWN])
      const later = yield* after(start, RAMP_TICKS)
      expect(later.pacing.loneMs).toBe(0)
      const pace = yield* paceOver(later, 1)
      expect(pace).toBeLessThan(SLOW * 2)
    }),
  )

  it.effect('the last three hurry together', () =>
    Effect.gen(function* () {
      const start = lastStanding([
        straggler,
        zombieAt(2, FAR_X, PLAYER_Y - 40, { speed: SLOW }),
        zombieAt(3, FAR_X, PLAYER_Y + 40, { speed: SLOW }),
      ])
      const ramped = yield* after(start, RAMP_TICKS)
      expect(ramped.pacing.loneMs).toBeGreaterThanOrEqual(
        DELAY + LAST_ZOMBIE_RULES.rampMs,
      )
      const pace = yield* paceOver(ramped, 2)
      expect(pace).toBeGreaterThan(PLAYER_SPEED - 4)
    }),
  )

  it.effect('it does not hurry while four are alive', () =>
    Effect.gen(function* () {
      const start = lastStanding([
        straggler,
        zombieAt(2, FAR_X, PLAYER_Y - 40, { speed: SLOW }),
        zombieAt(3, FAR_X, PLAYER_Y + 40, { speed: SLOW }),
        zombieAt(4, FAR_X - 30, PLAYER_Y, { speed: SLOW }),
      ])
      const later = yield* after(start, RAMP_TICKS)
      expect(later.pacing.loneMs).toBe(0)
      const pace = yield* paceOver(later, 1)
      expect(pace).toBeLessThan(SLOW * 2)
    }),
  )

  it.effect('Uncle Chunk alone never hurries', () =>
    Effect.gen(function* () {
      const start = modifyFields(lastStanding([bossAt(FAR_X, PLAYER_Y)]), {
        boss: () => fightingBoss(BossMove.Stalking({ cooldownMs: 60_000 })),
      })
      const later = yield* after(start, RAMP_TICKS)
      expect(later.pacing.loneMs).toBe(0)
    }),
  )

  it.effect('nothing hurries once the finale is under way', () =>
    Effect.gen(function* () {
      const start = modifyFields(lastStanding([straggler]), {
        dare: dare => modifyFields(dare, { finale: () => Finale.Open() }),
      })
      const later = yield* after(start, RAMP_TICKS)
      expect(later.pacing.loneMs).toBe(0)
    }),
  )
})
