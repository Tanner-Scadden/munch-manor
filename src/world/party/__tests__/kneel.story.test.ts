import { Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Life, type Model, Trap, TurretGun } from '#app/model.ts'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '#shared/constants.ts'
import {
  crewInWave,
  pipeline,
  placeSeat,
  withSeatLife,
} from '#test/model.fixture.ts'
import {
  checkModel,
  modelAfter,
  press,
  release,
  steps,
  ticks,
} from '#test/testing.ts'
import { TRAPS } from '#world/gear/traps.ts'
import { COOP_RULES, maybePlayerAt } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import type { Vector } from '#world/schema/worldSchema.ts'
import { distanceBetween } from '#world/step/geometry.ts'

const TICK_MS = FIXED_STEP_MS
const BODY: Vector = { x: 180, y: 84 }
const IN_FRONT: Vector = { x: BODY.x, y: BODY.y + 12 }
const FRONT_LEFT: Vector = { x: BODY.x - 6, y: BODY.y + 11 }
const SIDE_PX = PLAYER_RADIUS * 2 + 1
const LEFT_SIDE: Vector = { x: BODY.x - SIDE_PX, y: BODY.y }
const RIGHT_SIDE: Vector = { x: BODY.x + SIDE_PX, y: BODY.y }
const SLIDE_TICKS = 15
const REVIVE_TICKS = Math.ceil(COOP_RULES.reviveMs / TICK_MS)

const DOWNED = Life.Downed({
  bleedMs: COOP_RULES.bleedOutMs,
  reviveMs: 0,
  callMs: 0,
})

const positionOf = (current: World, slot: number): Vector => {
  const { player } = Option.getOrThrow(maybePlayerAt(current, slot))
  return { x: player.x, y: player.y }
}

const lifeOf = (current: World, slot: number): Life =>
  Option.getOrThrow(maybePlayerAt(current, slot)).seat.life

const reviveMsOf = (current: World, slot: number): number => {
  const life = lifeOf(current, slot)
  return life._tag === 'Downed' ? life.reviveMs : -1
}

const expectAt = (current: World, slot: number, spot: Vector): void => {
  expect(distanceBetween(positionOf(current, slot), spot)).toBeLessThan(0.01)
}

const gnomeAt = (id: number, column: number, row: number): Trap =>
  Trap.Turret({
    id,
    column,
    row,
    hp: TRAPS.Turret.hp,
    maxHp: TRAPS.Turret.hp,
    hitRemainingMs: 0,
    facing: { x: 0, y: 1 },
    gun: TurretGun.Armed(),
  })

const withTraps =
  (traps: ReadonlyArray<Trap>) =>
  (current: Model): Model =>
    UiStruct.evolve(current, { traps: () => traps })

const downedWith = (reviver: Vector, count = 2): Model =>
  pipeline(
    placeSeat(0, reviver.x, reviver.y),
    placeSeat(1, BODY.x, BODY.y, 0),
    withSeatLife(1, DOWNED),
  )(crewInWave(count))

describe('CPR at the body side', () => {
  it.effect(
    'a reviver standing in front slides to the side and kneels there',
    () =>
      modelAfter(
        downedWith(IN_FRONT),
        steps(
          ticks(1, TICK_MS),
          checkModel(current => {
            const moved = positionOf(current, 0)
            expect(moved.x).toBeGreaterThan(BODY.x)
            expect(distanceBetween(moved, RIGHT_SIDE)).toBeGreaterThan(5)
          }),
          ticks(SLIDE_TICKS, TICK_MS),
          checkModel(current => {
            expectAt(current, 0, RIGHT_SIDE)
            expect(lifeOf(current, 1)._tag).toBe('Downed')
          }),
        ),
      ),
  )

  it.effect('the nearer side wins', () =>
    modelAfter(
      downedWith(FRONT_LEFT),
      steps(
        ticks(SLIDE_TICKS, TICK_MS),
        checkModel(current => {
          expectAt(current, 0, LEFT_SIDE)
        }),
      ),
    ),
  )

  it.effect('the revive takes the same 2 s with the slide', () =>
    modelAfter(
      downedWith({ x: BODY.x, y: BODY.y + 15 }),
      steps(
        ticks(REVIVE_TICKS - 1, TICK_MS),
        checkModel(current => {
          expect(lifeOf(current, 1)._tag).toBe('Downed')
        }),
        ticks(1, TICK_MS),
        checkModel(current => {
          expect(lifeOf(current, 1)._tag).toBe('Standing')
        }),
      ),
    ),
  )

  it.effect('a blocked side sends the reviver to the other', () =>
    modelAfter(
      withTraps([gnomeAt(1, 16, 8)])(downedWith(FRONT_LEFT)),
      steps(
        ticks(SLIDE_TICKS, TICK_MS),
        checkModel(current => {
          expectAt(current, 0, RIGHT_SIDE)
        }),
      ),
    ),
  )

  it.effect('with both sides blocked the reviver stays where they are', () =>
    modelAfter(
      withTraps([gnomeAt(1, 16, 8), gnomeAt(2, 19, 8)])(downedWith(FRONT_LEFT)),
      steps(
        ticks(SLIDE_TICKS, TICK_MS),
        checkModel(current => {
          expectAt(current, 0, FRONT_LEFT)
          expect(reviveMsOf(current, 1)).toBeGreaterThan(0)
        }),
      ),
    ),
  )

  it.effect('two revivers take a side each', () =>
    modelAfter(
      placeSeat(
        2,
        BODY.x + 3,
        BODY.y - 12,
      )(downedWith({ x: BODY.x + 2, y: BODY.y + 12 }, 3)),
      steps(
        ticks(SLIDE_TICKS, TICK_MS),
        checkModel(current => {
          expectAt(current, 0, RIGHT_SIDE)
          expectAt(current, 2, LEFT_SIDE)
        }),
      ),
    ),
  )

  it.effect('a held stick still cancels the revive and stops the slide', () =>
    modelAfter(
      downedWith(IN_FRONT),
      steps(
        ticks(3, TICK_MS),
        checkModel(current => {
          expect(reviveMsOf(current, 1)).toBeGreaterThan(0)
          expect(positionOf(current, 0).x).toBeGreaterThan(IN_FRONT.x)
        }),
        press('KeyA'),
        ticks(6, TICK_MS),
        checkModel(current => {
          expect(reviveMsOf(current, 1)).toBe(0)
          expect(positionOf(current, 0).x).toBeLessThan(IN_FRONT.x)
        }),
        release('KeyA'),
      ),
    ),
  )
})
