import { Array, Option, String } from 'effect'
import type { Canvas } from 'foldkit'

import { type Sprite, TOP_LEFT, placeAt, spriteShapes } from '../art/sprite'
import type { Vector } from '../world/schema/entitySchema'
import {
  SCREEN_STEPS,
  type ScreenDirection,
  clamp,
} from '../world/step/geometry'
import { type Camera, worldToView } from './camera'
import { type ClearWindow, clearWindowOf } from './hudLayout'
import type { Screen } from './screen'

// NOTE: the big gold arrow that shows the way to a spot, in the overlay
// canvas's pixels. Out of sight (up under the HUD's top rows or past the
// window's edge), it waits at the window's edge pointing the way, bobbing
// toward it: the guided tours' next spot (src/features/onboarding/
// questEdgeView.ts) and the dare's things (src/features/dare/darePointer.ts).
// In sight, the dare's arrow bobs right over the spot, pointing down.

type Pointing = ScreenDirection

const UP_PIXELS: ReadonlyArray<string> = [
  '....o....',
  '...oyo...',
  '..oyyyo..',
  '.oyyyyyo.',
  'oyyyyyyyo',
  'oooyyyooo',
  '..oyyyo..',
  '..oyyyo..',
  '..ooooo..',
]

const ARROW_PALETTE = { o: '#140c10', y: '#ffe066' }
const ARROW_SIZE = 9
const EDGE_GAP = 3
const BOB_MS = 300
const BOB_PX = 2

const charAt = (row: string, column: number): string =>
  Option.getOrElse(String.charAt(row, column), () => '.')

const transposed = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.makeBy(ARROW_SIZE, column =>
    Array.join(
      Array.map(rows, row => charAt(row, column)),
      '',
    ),
  )

const reversedColumns = (rows: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(rows, row => Array.join(Array.reverse(String.split(row, '')), ''))

const arrowOf = (pixels: ReadonlyArray<string>): Sprite =>
  spriteShapes(pixels, ARROW_PALETTE, TOP_LEFT)

const ARROWS: Readonly<Record<Pointing, Sprite>> = {
  Up: arrowOf(UP_PIXELS),
  Down: arrowOf(Array.reverse(UP_PIXELS)),
  Left: arrowOf(transposed(UP_PIXELS)),
  Right: arrowOf(reversedColumns(transposed(UP_PIXELS))),
}

const UNDER: readonly [Pointing, number] = ['Up', 0]

// NOTE: the edge the spot lies past the furthest, so a spot up and a
// little left reads as up.
const pointingOf = (
  at: Vector,
  clear: ClearWindow,
): Option.Option<Pointing> => {
  const overs: ReadonlyArray<readonly [Pointing, number]> = [
    ['Up', clear.top - at.y],
    ['Down', at.y - clear.bottom],
    ['Left', clear.left - at.x],
    ['Right', at.x - clear.right],
  ]
  const [pointing, over] = Array.reduce(
    overs,
    UNDER,
    (most, next): readonly [Pointing, number] =>
      next[1] > most[1] ? next : most,
  )
  return over > 0 ? Option.some(pointing) : Option.none()
}

const bobOf = (elapsedMs: number): number =>
  (Math.floor(elapsedMs / BOB_MS) % 2) * BOB_PX

export type PointerAt = Readonly<{
  mark: Vector
  elapsedMs: number
  screen: Screen
  camera: Camera
}>

const edgeShapesAt = (
  at: Vector,
  clear: ClearWindow,
  pointing: Pointing,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const bob = bobOf(elapsedMs)
  const step = SCREEN_STEPS[pointing]
  const x = clamp(at.x - ARROW_SIZE / 2, clear.left, clear.right - ARROW_SIZE)
  const y = clamp(at.y - ARROW_SIZE / 2, clear.top, clear.bottom - ARROW_SIZE)
  return [
    placeAt(
      Math.round(x + step.x * bob),
      Math.round(y + step.y * bob),
      ARROWS[pointing],
    ),
  ]
}

// NOTE: only while the spot is out of sight; in sight, the caller draws its
// own mark over it.
export const edgeArrowShapes = ({
  mark,
  elapsedMs,
  screen,
  camera,
}: PointerAt): ReadonlyArray<Canvas.Shape> => {
  const at = worldToView(camera, mark)
  const clear = clearWindowOf(screen, EDGE_GAP)
  return Option.match(pointingOf(at, clear), {
    onNone: () => [],
    onSome: pointing => edgeShapesAt(at, clear, pointing, elapsedMs),
  })
}

// NOTE: the arrow's tip sits this far over the spot, so it clears a thing
// standing there.
const POINTER_LIFT = 2

// NOTE: a spot the world window shows with room over it for the arrow,
// even up under the HUD's top rows, where an edge arrow would sit on the
// thing itself.
const isOverInWindow = (at: Vector, screen: Screen): boolean => {
  const window = screen.world
  return (
    at.x >= window.x &&
    at.x <= window.x + window.width &&
    at.y - POINTER_LIFT - ARROW_SIZE - BOB_PX >= window.y &&
    at.y <= window.y + window.height
  )
}

const overShapes = (
  at: Vector,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => [
  placeAt(
    Math.round(at.x - ARROW_SIZE / 2),
    Math.round(at.y) - POINTER_LIFT - ARROW_SIZE - bobOf(elapsedMs),
    ARROWS.Down,
  ),
]

// NOTE: at the edge while the spot is out of sight, and in sight right over
// it, pointing down, its tip just above the spot.
export const pointerArrowShapes = ({
  mark,
  elapsedMs,
  screen,
  camera,
}: PointerAt): ReadonlyArray<Canvas.Shape> => {
  const at = worldToView(camera, mark)
  const clear = clearWindowOf(screen, EDGE_GAP)
  return Option.match(pointingOf(at, clear), {
    onNone: () => overShapes(at, elapsedMs),
    onSome: pointing =>
      pointing === 'Up' && isOverInWindow(at, screen)
        ? overShapes(at, elapsedMs)
        : edgeShapesAt(at, clear, pointing, elapsedMs),
  })
}
