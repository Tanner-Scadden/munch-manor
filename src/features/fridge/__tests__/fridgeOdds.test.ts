import { Array, Match, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { describe, expect, test } from '@effect/vitest'

import { cameraOf } from '../../../render/camera'
import { clearWindowOf } from '../../../render/hudLayout'
import { screenOf } from '../../../render/screen'
import { atFridge } from '../../../test/model.fixture'
import { drawnBoxesOf, isOverBox } from '../../../test/viewReading'
import { PRIZE_ORDER } from '../../../world/fridge/leftovers'
import {
  fridgeOddsKeepoutsOf,
  fridgeOddsShapes,
  fridgeOverheadShapes,
} from '../fridgeView'

// The fridge's odds note: once a blank cream card in the kitchen's corner,
// since it stood in the 3D world's overhead strata, where each leaf stands
// at its own foot and the card hid its own rows. It is drawn on the overlay
// now, the card first and its rows on it, and kept off everything pinned.

const model = atFridge(10)
const camera = cameraOf(model)

const scaleOf = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  Option.getOrElse(
    Option.flatMap(Array.head(shapes), shape =>
      Match.value(shape).pipe(
        Match.tag('Group', ({ scale }) => Option.some(scale?.x ?? 1)),
        Match.orElse(() => Option.none()),
      ),
    ),
    () => 0,
  )

describe('the fridge odds note', () => {
  test('draws its rows on its card, never a blank card', () => {
    const shapes = fridgeOddsShapes(model, camera, [])
    const boxes = drawnBoxesOf(shapes)
    const card = boxes[0]
    const rows = Array.drop(boxes, 1)
    expect(card).toBeDefined()
    expect(rows.length).toBeGreaterThanOrEqual(PRIZE_ORDER.length)
    Array.forEach(rows, row => {
      expect(row.left).toBeGreaterThanOrEqual(card?.left ?? Infinity)
      expect(row.right).toBeLessThanOrEqual(card?.right ?? -Infinity)
      expect(row.top).toBeGreaterThanOrEqual(card?.top ?? Infinity)
      expect(row.bottom).toBeLessThanOrEqual(card?.bottom ?? -Infinity)
    })
  })

  test('draws on whole screen pixels at a whole scale', () => {
    const shapes = fridgeOddsShapes(model, camera, [])
    const scale = scaleOf(shapes)
    expect(Number.isInteger(scale)).toBe(true)
    Array.forEach(drawnBoxesOf(shapes), ({ left, top }) => {
      expect(Number.isInteger(left)).toBe(true)
      expect(Number.isInteger(top)).toBe(true)
    })
  })

  test('stands no card in the 3D world', () => {
    const overlay = drawnBoxesOf(fridgeOddsShapes(model, camera, []))
    const scale = scaleOf(fridgeOddsShapes(model, camera, []))
    const card = overlay[0]
    const width = ((card?.right ?? 0) - (card?.left ?? 0)) / scale
    const height = ((card?.bottom ?? 0) - (card?.top ?? 0)) / scale
    const overhead = drawnBoxesOf(fridgeOverheadShapes(model))
    expect(
      Array.some(
        overhead,
        box =>
          box.right - box.left === width && box.bottom - box.top === height,
      ),
    ).toBe(false)
  })

  test('keeps out where it is drawn, inside the window', () => {
    const [covers] = fridgeOddsKeepoutsOf(model, camera, [])
    const clear = clearWindowOf(screenOf(model), 0)
    expect(covers).toBeDefined()
    Array.forEach(drawnBoxesOf(fridgeOddsShapes(model, camera, [])), box => {
      expect(box.left).toBeGreaterThanOrEqual(covers?.left ?? Infinity)
      expect(box.right).toBeLessThanOrEqual(covers?.right ?? -Infinity)
    })
    expect(covers?.left ?? -1).toBeGreaterThanOrEqual(clear.left)
    expect(covers?.right ?? Infinity).toBeLessThanOrEqual(clear.right)
  })

  test('moves off a keepout, and waits when nowhere is clear', () => {
    const [covers] = fridgeOddsKeepoutsOf(model, camera, [])
    const keptOut = Option.getOrThrow(Option.fromNullishOr(covers))
    const [moved] = fridgeOddsKeepoutsOf(model, camera, [keptOut])
    expect(moved).toBeDefined()
    expect(Option.exists(Option.fromNullishOr(moved), isOverBox(keptOut))).toBe(
      false,
    )
    const everywhere = {
      left: -10_000,
      top: -10_000,
      right: 10_000,
      bottom: 10_000,
    }
    expect(fridgeOddsShapes(model, camera, [everywhere])).toEqual([])
    expect(fridgeOddsKeepoutsOf(model, camera, [everywhere])).toEqual([])
  })
})
