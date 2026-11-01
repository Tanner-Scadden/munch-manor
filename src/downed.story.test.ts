import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS } from './constants'
import { QUARTER_TURN } from './drawing'
import { healthBarShapes } from './healthBarView'
import { sceneShapes } from './layers'
import { update } from './main'
import { Arsenal, Life, type Model, Reload } from './model'
import {
  atSeat,
  crewInWave,
  pipeline,
  placeSeat,
  withSeatLife,
} from './model.fixture'
import { COOP_RULES } from './party'
import { reviveRingGroundShapes } from './partyView'
import { reloadBarShapes } from './playerView'
import { maybeOfferInReach } from './purchase'
import { STALL_BOX } from './shop'
import { ticks } from './testing'
import { freshGun } from './weapons'

// A co-op player out of the fight, as everyone sees them (MULTIPLAYER.md,
// "Life"): downed, they lie on the floor with a bleed bar, a revive icon,
// and a ring on the floor that fills while a teammate stands still in it;
// bled out, they stay a body on the floor until the break.

const TICK_MS = FIXED_STEP_MS
const LEFT_X = 60
const RIGHT_X = 240
const ROW_Y = 104

const allShapes = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(shapes, shape =>
    shape._tag === 'Group' ? [shape, ...allShapes(shape.shapes)] : [shape],
  )

// NOTE: a lying body is the only group turned a quarter in a fight.
const lyingBodies = (current: Model): ReadonlyArray<Canvas.Group> =>
  Array.filter(
    allShapes(sceneShapes(current)),
    (shape): shape is Canvas.Group =>
      shape._tag === 'Group' &&
      shape.rotate !== undefined &&
      Math.abs(Math.abs(shape.rotate) - QUARTER_TURN) < 1e-9,
  )

const isDrawn = (current: Model, wanted: Canvas.Shape): boolean => {
  const json = JSON.stringify(wanted)
  return Array.some(
    allShapes(sceneShapes(current)),
    shape => JSON.stringify(shape) === json,
  )
}

const isImage = (shape: Canvas.Shape): shape is Canvas.Image =>
  shape._tag === 'Image'

// NOTE: a full bleed bar is one baked image; another bar's image differs.
const hasBleedBar = (current: Model): boolean => {
  const wanted = Array.filter(
    healthBarShapes('Small', 'Ally', 0, 0, 1),
    isImage,
  )
  return Array.some(allShapes(sceneShapes(current)), shape =>
    Array.some(
      wanted,
      bar =>
        isImage(shape) &&
        shape.src === bar.src &&
        JSON.stringify(shape.crop) === JSON.stringify(bar.crop),
    ),
  )
}

const downedAt = (slot: number) =>
  withSeatLife(
    slot,
    Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0 }),
  )

describe('a downed teammate', () => {
  const apart = pipeline(
    placeSeat(0, LEFT_X, ROW_Y),
    placeSeat(1, RIGHT_X, ROW_Y, 0),
    downedAt(1),
  )(crewInWave(2))

  test('lies on the floor with a bleed bar, while the standing player stands', () => {
    story(
      update,
      given(apart),
      ...ticks(1, TICK_MS),
      model(current => {
        expect(lyingBodies(current)).toHaveLength(1)
        expect(hasBleedBar(current)).toBe(true)
      }),
    )
  })

  test('has a faint revive ring that fills while a teammate stands still in it', () => {
    const beside = placeSeat(0, RIGHT_X - 8, ROW_Y)(apart)
    const half = Math.floor(COOP_RULES.reviveMs / TICK_MS / 2)
    story(
      update,
      given(apart),
      ...ticks(1, TICK_MS),
      model(current => {
        const rings = reviveRingGroundShapes(current)
        expect(rings).toHaveLength(1)
        Array.forEach(rings, ring => {
          expect(ring._tag === 'Group' && ring.opacity).toBeLessThan(1)
          expect(isDrawn(current, ring)).toBe(true)
        })
      }),
    )
    story(
      update,
      given(beside),
      ...ticks(half, TICK_MS),
      model(current => {
        const rings = reviveRingGroundShapes(current)
        expect(rings).toHaveLength(1)
        Array.forEach(rings, ring => {
          expect(ring._tag === 'Group' && ring.opacity).toBe(1)
          expect(isDrawn(current, ring)).toBe(true)
        })
        expect(rings).not.toEqual(reviveRingGroundShapes(apart))
      }),
    )
  })

  test('stands up again once revived, with no ring left', () => {
    const beside = placeSeat(0, RIGHT_X - 8, ROW_Y)(apart)
    story(
      update,
      given(beside),
      ...ticks(Math.ceil(COOP_RULES.reviveMs / TICK_MS) + 1, TICK_MS),
      model(current => {
        expect(lyingBodies(current)).toHaveLength(0)
        expect(reviveRingGroundShapes(current)).toHaveLength(0)
      }),
    )
  })
})

describe('a bled-out teammate', () => {
  test('stays a faded body on the floor, with no bars', () => {
    story(
      update,
      given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y),
          placeSeat(1, RIGHT_X, ROW_Y, 0),
          withSeatLife(1, Life.BledOut()),
        )(crewInWave(2)),
      ),
      ...ticks(1, TICK_MS),
      model(current => {
        const bodies = lyingBodies(current)
        expect(bodies).toHaveLength(1)
        Array.forEach(bodies, body => {
          expect(body.opacity).toBeLessThan(1)
        })
        expect(hasBleedBar(current)).toBe(false)
        expect(reviveRingGroundShapes(current)).toHaveLength(0)
      }),
    )
  })
})

describe('your own downed player', () => {
  const reloading = (current: Model): Model =>
    atSeat(current, 0, world =>
      modifyFields(world, {
        player: player =>
          modifyFields(player, {
            reload: () =>
              Reload.Reloading({ remainingMs: 500, durationMs: 1000 }),
          }),
      }),
    )

  test('lies down too, with no gun up and no reload bar', () => {
    story(
      update,
      given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y, 0),
          placeSeat(1, RIGHT_X, ROW_Y),
          downedAt(0),
          reloading,
        )(crewInWave(2)),
      ),
      ...ticks(1, TICK_MS),
      model(current => {
        expect(lyingBodies(current)).toHaveLength(1)
        expect(
          Array.some(reloadBarShapes(current.player), bar =>
            isDrawn(current, bar),
          ),
        ).toBe(false)
      }),
    )
  })

  test('is offered nothing to buy at the ammo window', () => {
    const stallX = (STALL_BOX.left + STALL_BOX.right) / 2
    const armed = (current: Model): Model =>
      atSeat(current, 0, world =>
        modifyFields(world, {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                Arsenal.HoldingSecond({
                  first: freshGun('Pistol'),
                  second: freshGun('Smg'),
                }),
            }),
        }),
      )
    const atStall = pipeline(
      armed,
      placeSeat(0, stallX, STALL_BOX.bottom + 6),
      placeSeat(1, LEFT_X, ROW_Y),
    )(crewInWave(2))
    expect(Option.isSome(maybeOfferInReach(atStall))).toBe(true)
    expect(Option.isNone(maybeOfferInReach(downedAt(0)(atStall)))).toBe(true)
  })
})
