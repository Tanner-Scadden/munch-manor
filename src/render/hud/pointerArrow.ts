import { Array, Option, String } from 'effect'

import { type Sprite, TOP_LEFT, placeAt, spriteShapes } from '#art/sprite.ts'
import { type Camera, worldToView } from '#render/camera/camera.ts'
import type { Screen } from '#render/camera/screen.ts'
import type * as Draw from '#render/draw.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import {
  SCREEN_STEPS,
  type ScreenDirection,
  clamp,
} from '#world/step/geometry.ts'

import { type ClearWindow, clearWindowOf } from './hudLayout.ts'

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
  liftPx: number
  elapsedMs: number
  screen: Screen
  camera: Camera
}>

const liftedAt = (camera: Camera, mark: Vector, liftPx: number): Vector => {
  const at = worldToView(camera, mark)
  return { x: at.x, y: at.y - liftPx * camera.scale }
}

const edgeShapesAt = (
  at: Vector,
  clear: ClearWindow,
  pointing: Pointing,
  elapsedMs: number,
): ReadonlyArray<Draw.Shape> => {
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

export const edgeArrowShapes = ({
  mark,
  liftPx,
  elapsedMs,
  screen,
  camera,
}: PointerAt): ReadonlyArray<Draw.Shape> => {
  const at = liftedAt(camera, mark, liftPx)
  const clear = clearWindowOf(screen, EDGE_GAP)
  return Option.match(pointingOf(at, clear), {
    onNone: () => [],
    onSome: pointing => edgeShapesAt(at, clear, pointing, elapsedMs),
  })
}

const POINTER_LIFT = 2

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
): ReadonlyArray<Draw.Shape> => [
  placeAt(
    Math.round(at.x - ARROW_SIZE / 2),
    Math.round(at.y) - POINTER_LIFT - ARROW_SIZE - bobOf(elapsedMs),
    ARROWS.Down,
  ),
]

export const pointerArrowShapes = ({
  mark,
  liftPx,
  elapsedMs,
  screen,
  camera,
}: PointerAt): ReadonlyArray<Draw.Shape> => {
  const at = liftedAt(camera, mark, liftPx)
  const clear = clearWindowOf(screen, EDGE_GAP)
  return Option.match(pointingOf(at, clear), {
    onNone: () => overShapes(at, elapsedMs),
    onSome: pointing =>
      pointing === 'Up' && isOverInWindow(at, screen)
        ? overShapes(at, elapsedMs)
        : edgeShapesAt(at, clear, pointing, elapsedMs),
  })
}
