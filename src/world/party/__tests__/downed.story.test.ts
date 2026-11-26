import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { sceneShapes } from '../../../app/layers'
import { Life, type Model, Reload } from '../../../app/model'
import type * as Draw from '../../../render/draw'
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
import {
  checkModel,
  jsonOf,
  modelAfter,
  steps,
  ticks,
} from '../../../test/testing'
import { MEDIC_RULES } from '../medic'
import { COOP_RULES, focusOf, maybePlayerAt, modifyFocus } from '../party'

const TICK_MS = FIXED_STEP_MS
const LEFT_X = 60
const RIGHT_X = 240
const ROW_Y = 104

const allShapes = (
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
  Array.flatMap(shapes, shape =>
    shape._tag === 'Group' ? [shape, ...allShapes(shape.shapes)] : [shape],
  )

const lyingBodies = (current: Model): ReadonlyArray<Draw.Group> =>
  Array.filter(
    allShapes(sceneShapes(current)),
    (shape): shape is Draw.Group =>
      shape._tag === 'Group' &&
      shape.rotate !== undefined &&
      Math.abs(Math.abs(shape.rotate) - QUARTER_TURN) < 1e-9,
  )

const isDrawn = (current: Model, wanted: Draw.Shape): boolean => {
  const json = jsonOf(wanted)
  return Array.some(
    allShapes(sceneShapes(current)),
    shape => jsonOf(shape) === json,
  )
}

const isImage = (shape: Draw.Shape): shape is Draw.Image =>
  shape._tag === 'Image'

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
      modelAfter(
        apart,
        steps(
          ticks(1, TICK_MS),
          checkModel(current => {
            expect(lyingBodies(current)).toHaveLength(1)
            expect(hasBleedBar(current)).toBe(true)
          }),
        ),
      ),
  )

  it.effect(
    'has a faint revive ring that fills while a teammate stands still in it',
    () =>
      Effect.gen(function* () {
        const beside = placeSeat(0, RIGHT_X - 8, ROW_Y)(apart)
        const half = Math.floor(COOP_RULES.reviveMs / TICK_MS / 2)
        yield* modelAfter(
          apart,
          steps(
            ticks(1, TICK_MS),
            checkModel(current => {
              const rings = reviveRingGroundShapes(current)
              expect(rings).toHaveLength(1)
              Array.forEach(rings, ring => {
                expect(ring._tag === 'Group' && ring.opacity).toBeLessThan(1)
                expect(isDrawn(current, ring)).toBe(true)
              })
            }),
          ),
        )
        yield* modelAfter(
          beside,
          steps(
            ticks(half, TICK_MS),
            checkModel(current => {
              const rings = reviveRingGroundShapes(current)
              expect(rings).toHaveLength(1)
              Array.forEach(rings, ring => {
                expect(ring._tag === 'Group' && ring.opacity).toBe(1)
                expect(isDrawn(current, ring)).toBe(true)
              })
              expect(rings).not.toEqual(reviveRingGroundShapes(apart))
            }),
          ),
        )
      }),
  )

  it.effect('stands up again once revived, with no ring left', () => {
    const beside = placeSeat(0, RIGHT_X - 8, ROW_Y)(apart)
    return modelAfter(
      beside,
      steps(
        ticks(Math.ceil(COOP_RULES.reviveMs / TICK_MS) + 1, TICK_MS),
        checkModel(current => {
          expect(lyingBodies(current)).toHaveLength(0)
          expect(reviveRingGroundShapes(current)).toHaveLength(0)
        }),
      ),
    )
  })
})

describe('a bled-out teammate', () => {
  it.effect('stays a faded body on the floor, with no bars', () =>
    modelAfter(
      pipeline(
        placeSeat(0, LEFT_X, ROW_Y),
        placeSeat(1, RIGHT_X, ROW_Y, 0),
        withSeatLife(1, Life.BledOut()),
      )(crewInWave(2)),
      steps(
        ticks(1, TICK_MS),
        checkModel(current => {
          const bodies = lyingBodies(current)
          expect(bodies).toHaveLength(1)
          Array.forEach(bodies, body => {
            expect(body.opacity).toBeLessThan(1)
          })
          expect(hasBleedBar(current)).toBe(false)
          expect(reviveRingGroundShapes(current)).toHaveLength(0)
        }),
      ),
    ),
  )
})

describe('your own downed player', () => {
  const reloading = (current: Model): Model =>
    atSeat(current, 0, world =>
      modifyFocus(world, {
        player: player =>
          UiStruct.evolve(player, {
            reload: () =>
              Reload.Reloading({ remainingMs: 500, durationMs: 1000 }),
          }),
      }),
    )

  it.effect('lies down too, with no gun up and no reload bar', () =>
    modelAfter(
      pipeline(
        placeSeat(0, LEFT_X, ROW_Y, 0),
        placeSeat(1, RIGHT_X, ROW_Y),
        downedAt(0),
        reloading,
      )(crewInWave(2)),
      steps(
        ticks(1, TICK_MS),
        checkModel(current => {
          expect(lyingBodies(current)).toHaveLength(1)
          expect(
            Array.some(reloadBarShapes(focusOf(current).player), bar =>
              isDrawn(current, bar),
            ),
          ).toBe(false)
        }),
      ),
    ),
  )
})

describe('the MEDIC bubble', () => {
  const calledAt = (slot: number, callMs: number) =>
    withSeatLife(
      slot,
      Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0, callMs }),
    )

  const bubbleOf = (current: Model, slot: number): Draw.Shape => {
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
      modelAfter(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y, 0),
          placeSeat(1, RIGHT_X, ROW_Y, 0),
          calledAt(0, 0),
          calledAt(1, 0),
        )(crewInWave(3)),
        steps(
          ticks(1, TICK_MS),
          checkModel(current => {
            expect(isDrawn(current, bubbleOf(current, 0))).toBe(true)
            expect(isDrawn(current, bubbleOf(current, 1))).toBe(true)
          }),
        ),
      ),
  )

  it.effect(
    'is gone once the shout is old, and never over a standing player',
    () =>
      modelAfter(
        pipeline(
          placeSeat(0, LEFT_X, ROW_Y),
          placeSeat(1, RIGHT_X, ROW_Y, 0),
          calledAt(1, MEDIC_RULES.freshMs),
        )(crewInWave(2)),
        steps(
          ticks(1, TICK_MS),
          checkModel(current => {
            expect(isDrawn(current, bubbleOf(current, 1))).toBe(false)
            expect(isDrawn(current, medicBubbleShape(LEFT_X, ROW_Y, 0))).toBe(
              false,
            )
          }),
        ),
      ),
  )
})
