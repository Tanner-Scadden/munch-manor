import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Life, type Model, Trap, TurretGun } from '../../../app/model'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '../../../shared/constants'
import {
  crewInWave,
  pipeline,
  placeSeat,
  withSeatLife,
} from '../../../test/model.fixture'
import { APPLICATION, press, release, ticks } from '../../../test/testing'
import { TRAPS } from '../../gear/traps'
import type { World } from '../../schema/world'
import type { Vector } from '../../schema/worldSchema'
import { distanceBetween } from '../../step/geometry'
import { COOP_RULES, maybePlayerAt } from '../party'

// CPR at the body's side (owner, 2026-11-12, src/world/party/revive.ts): a
// teammate who stands still in reach of a downed player slides over a few
// frames to kneel a body's width to their left or right, the nearer side
// first, then the other, then where they stand. The revive's reach, its
// clock, and a held stick's cancel are as they were.

const TICK_MS = FIXED_STEP_MS
// NOTE: the open floor north of the dining room's table, clear for a
// body's width and more on every side.
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

// NOTE: a pea gnome standing on the tile at `column`, `row` (10 px tiles):
// a solid box the reviver cannot kneel in.
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
    modifyFields(current, { traps: () => traps })

// NOTE: seat 1 down on BODY, the lead seat at `reviver`.
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
      Story.story(
        APPLICATION,
        Story.given(downedWith(IN_FRONT)),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          const moved = positionOf(current, 0)
          expect(moved.x).toBeGreaterThan(BODY.x)
          expect(distanceBetween(moved, RIGHT_SIDE)).toBeGreaterThan(5)
        }),
        ...ticks(SLIDE_TICKS, TICK_MS),
        Story.model(current => {
          expectAt(current, 0, RIGHT_SIDE)
          expect(lifeOf(current, 1)._tag).toBe('Downed')
        }),
      ),
  )

  it.effect('the nearer side wins', () =>
    Story.story(
      APPLICATION,
      Story.given(downedWith(FRONT_LEFT)),
      ...ticks(SLIDE_TICKS, TICK_MS),
      Story.model(current => {
        expectAt(current, 0, LEFT_SIDE)
      }),
    ),
  )

  it.effect('the revive takes the same 2 s with the slide', () =>
    Story.story(
      APPLICATION,
      Story.given(downedWith({ x: BODY.x, y: BODY.y + 15 })),
      ...ticks(REVIVE_TICKS - 1, TICK_MS),
      Story.model(current => {
        expect(lifeOf(current, 1)._tag).toBe('Downed')
      }),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(lifeOf(current, 1)._tag).toBe('Standing')
      }),
    ),
  )

  it.effect('a blocked side sends the reviver to the other', () =>
    Story.story(
      APPLICATION,
      Story.given(withTraps([gnomeAt(1, 16, 8)])(downedWith(FRONT_LEFT))),
      ...ticks(SLIDE_TICKS, TICK_MS),
      Story.model(current => {
        expectAt(current, 0, RIGHT_SIDE)
      }),
    ),
  )

  it.effect('with both sides blocked the reviver stays where they are', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withTraps([gnomeAt(1, 16, 8), gnomeAt(2, 19, 8)])(
          downedWith(FRONT_LEFT),
        ),
      ),
      ...ticks(SLIDE_TICKS, TICK_MS),
      Story.model(current => {
        expectAt(current, 0, FRONT_LEFT)
        expect(reviveMsOf(current, 1)).toBeGreaterThan(0)
      }),
    ),
  )

  it.effect('two revivers take a side each', () =>
    Story.story(
      APPLICATION,
      Story.given(
        placeSeat(
          2,
          BODY.x + 3,
          BODY.y - 12,
        )(downedWith({ x: BODY.x + 2, y: BODY.y + 12 }, 3)),
      ),
      ...ticks(SLIDE_TICKS, TICK_MS),
      Story.model(current => {
        expectAt(current, 0, RIGHT_SIDE)
        expectAt(current, 2, LEFT_SIDE)
      }),
    ),
  )

  it.effect('a held stick still cancels the revive and stops the slide', () =>
    Story.story(
      APPLICATION,
      Story.given(downedWith(IN_FRONT)),
      ...ticks(3, TICK_MS),
      Story.model(current => {
        expect(reviveMsOf(current, 1)).toBeGreaterThan(0)
        expect(positionOf(current, 0).x).toBeGreaterThan(IN_FRONT.x)
      }),
      press('KeyA'),
      ...ticks(6, TICK_MS),
      Story.model(current => {
        expect(reviveMsOf(current, 1)).toBe(0)
        expect(positionOf(current, 0).x).toBeLessThan(IN_FRONT.x)
      }),
      release('KeyA'),
    ),
  )
})
