import { Array, Effect, Option } from 'effect'
import { type Canvas, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { sceneShapes } from '../../../app/layers'
import { Life, type Model, Reload } from '../../../app/model'
import { QUARTER_TURN } from '../../../render/drawing'
import { healthBarShapes } from '../../../render/healthBarView'
import {
  medicBubbleShape,
  reviveRingGroundShapes,
} from '../../../render/partyView'
import { reloadBarShapes } from '../../../render/playerView'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  atSeat,
  crewInWave,
  pipeline,
  placeSeat,
  withSeatLife,
} from '../../../test/model.fixture'
import { APPLICATION, jsonOf, ticks } from '../../../test/testing'
import { MEDIC_RULES } from '../medic'
import { COOP_RULES, focusOf, maybePlayerAt, modifyFocus } from '../party'

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
  const json = jsonOf(wanted)
  return Array.some(
    allShapes(sceneShapes(current)),
    shape => jsonOf(shape) === json,
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
        jsonOf({ crop: shape.crop }) === jsonOf({ crop: bar.crop }),
    ),
  )
}

const downedAt = (slot: number) =>
  withSeatLife(
    slot,
    Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0, callMs: 0 }),
  )

describe('a downed teammate', () => {
  const apart = pipeline(
    placeSeat(0, LEFT_X, ROW_Y),
    placeSeat(1, RIGHT_X, ROW_Y, 0),
    downedAt(1),
  )(crewInWave(2))

  it.effect(
    'lies on the floor with a bleed bar, while the standing player stands',
    () =>
      Story.story(
        APPLICATION,
        Story.given(apart),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          expect(lyingBodies(current)).toHaveLength(1)
          expect(hasBleedBar(current)).toBe(true)
        }),
      ),
  )

  it.effect(
    'has a faint revive ring that fills while a teammate stands still in it',
    () =>
      Effect.gen(function* () {
        const beside = placeSeat(0, RIGHT_X - 8, ROW_Y)(apart)
        const half = Math.floor(COOP_RULES.reviveMs / TICK_MS / 2)
        yield* Story.story(
          APPLICATION,
          Story.given(apart),
          ...ticks(1, TICK_MS),
          Story.model(current => {
            const rings = reviveRingGroundShapes(current)
            expect(rings).toHaveLength(1)
            Array.forEach(rings, ring => {
              expect(ring._tag === 'Group' && ring.opacity).toBeLessThan(1)
              expect(isDrawn(current, ring)).toBe(true)
            })
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(beside),
          ...ticks(half, TICK_MS),
          Story.model(current => {
            const rings = reviveRingGroundShapes(current)
            expect(rings).toHaveLength(1)
            Array.forEach(rings, ring => {
              expect(ring._tag === 'Group' && ring.opacity).toBe(1)
              expect(isDrawn(current, ring)).toBe(true)
            })
            expect(rings).not.toEqual(reviveRingGroundShapes(apart))
          }),
        )
      }),
  )

  it.effect('stands up again once revived, with no ring left', () => {
    const beside = placeSeat(0, RIGHT_X - 8, ROW_Y)(apart)
    return Story.story(
      APPLICATION,
      Story.given(beside),
      ...ticks(Math.ceil(COOP_RULES.reviveMs / TICK_MS) + 1, TICK_MS),
      Story.model(current => {
        expect(lyingBodies(current)).toHaveLength(0)
        expect(reviveRingGroundShapes(current)).toHaveLength(0)
      }),
    )
  })
})

describe('a bled-out teammate', () => {
  it.effect('stays a faded body on the floor, with no bars', () =>
    Story.story(
      APPLICATION,
      Story.given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y),
          placeSeat(1, RIGHT_X, ROW_Y, 0),
          withSeatLife(1, Life.BledOut()),
        )(crewInWave(2)),
      ),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        const bodies = lyingBodies(current)
        expect(bodies).toHaveLength(1)
        Array.forEach(bodies, body => {
          expect(body.opacity).toBeLessThan(1)
        })
        expect(hasBleedBar(current)).toBe(false)
        expect(reviveRingGroundShapes(current)).toHaveLength(0)
      }),
    ),
  )
})

describe('your own downed player', () => {
  const reloading = (current: Model): Model =>
    atSeat(current, 0, world =>
      modifyFocus(world, {
        player: player =>
          modifyFields(player, {
            reload: () =>
              Reload.Reloading({ remainingMs: 500, durationMs: 1000 }),
          }),
      }),
    )

  it.effect('lies down too, with no gun up and no reload bar', () =>
    Story.story(
      APPLICATION,
      Story.given(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y, 0),
          placeSeat(1, RIGHT_X, ROW_Y),
          downedAt(0),
          reloading,
        )(crewInWave(2)),
      ),
      ...ticks(1, TICK_MS),
      Story.model(current => {
        expect(lyingBodies(current)).toHaveLength(1)
        expect(
          Array.some(reloadBarShapes(focusOf(current).player), bar =>
            isDrawn(current, bar),
          ),
        ).toBe(false)
      }),
    ),
  )
})

describe('the MEDIC bubble', () => {
  const calledAt = (slot: number, callMs: number) =>
    withSeatLife(
      slot,
      Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0, callMs }),
    )

  const bubbleOf = (current: Model, slot: number): Canvas.Shape => {
    const { player, seat } = Option.getOrThrow(maybePlayerAt(current, slot))
    return medicBubbleShape(
      player.x,
      player.y,
      seat.life._tag === 'Downed' ? seat.life.callMs : 0,
    )
  }

  it.effect(
    'pops over a teammate who just shouted, and over your own body',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          pipeline(
            placeSeat(0, LEFT_X, ROW_Y, 0),
            placeSeat(1, RIGHT_X, ROW_Y, 0),
            calledAt(0, 0),
            calledAt(1, 0),
          )(crewInWave(3)),
        ),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          expect(isDrawn(current, bubbleOf(current, 0))).toBe(true)
          expect(isDrawn(current, bubbleOf(current, 1))).toBe(true)
        }),
      ),
  )

  it.effect(
    'is gone once the shout is old, and never over a standing player',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          pipeline(
            placeSeat(0, LEFT_X, ROW_Y),
            placeSeat(1, RIGHT_X, ROW_Y, 0),
            calledAt(1, MEDIC_RULES.freshMs),
          )(crewInWave(2)),
        ),
        ...ticks(1, TICK_MS),
        Story.model(current => {
          expect(isDrawn(current, bubbleOf(current, 1))).toBe(false)
          expect(isDrawn(current, medicBubbleShape(LEFT_X, ROW_Y, 0))).toBe(
            false,
          )
        }),
      ),
  )
})
