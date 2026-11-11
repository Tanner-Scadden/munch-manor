import { Array, Function, Option, String, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { type Sprite, TOP_LEFT, placeAt, spriteShapes } from '../../art/sprite'
import { type Camera, worldToView } from '../../render/camera'
import { type ClearWindow, clearWindowOf } from '../../render/hudLayout'
import type { Screen } from '../../render/screen'
import type { Vector } from '../../world/schema/entitySchema'
import { clamp } from '../../world/step/geometry'
import { maybePadlockPointer, maybeQuestMark } from './firstBreakQuest'
import { maybeKitchenMark } from './kitchenTour'

// NOTE: the guided tours' next spot (the padlock's boards, the case, the
// kitchen's boards) can sit out of sight: up under the HUD's top rows or
// past the window's edge, where the arrow bobbing over it cannot be seen.
// A new player then had a lit step in the tracker and nothing to follow
// (2026-11-10 walkthrough). So a big gold arrow waits at the window's edge,
// pointing the way, bobbing toward it, until the spot comes into sight.
// Outside the tours it points the same way to a padlock the keys can open.

type Pointing = 'Up' | 'Down' | 'Left' | 'Right'

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

const BOB_STEP: Readonly<Record<Pointing, Vector>> = {
  Up: { x: 0, y: -1 },
  Down: { x: 0, y: 1 },
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
}

const UNDER: readonly [Pointing, number] = ['Up', 0]

// NOTE: the tours' next spot, or outside them an affordable padlock
// (maybePadlockPointer in ./firstBreakQuest).
const maybeTourMark = (model: Model): Option.Option<Vector> =>
  pipe(
    maybeQuestMark(model),
    Option.orElse(() => maybeKitchenMark(model)),
    Option.orElse(() => maybePadlockPointer(model)),
  )

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

// NOTE: in the overlay canvas's pixels, from the screen camera.
export const questEdgeShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    Option.match(maybeTourMark(model), {
      onNone: () => [],
      onSome: mark => {
        const at = worldToView(camera, mark)
        const clear = clearWindowOf(screen, EDGE_GAP)
        return Option.match(pointingOf(at, clear), {
          onNone: () => [],
          onSome: pointing => {
            const bob = (Math.floor(model.elapsedMs / BOB_MS) % 2) * BOB_PX
            const step = BOB_STEP[pointing]
            const x = clamp(
              at.x - ARROW_SIZE / 2,
              clear.left,
              clear.right - ARROW_SIZE,
            )
            const y = clamp(
              at.y - ARROW_SIZE / 2,
              clear.top,
              clear.bottom - ARROW_SIZE,
            )
            return [
              placeAt(
                Math.round(x + step.x * bob),
                Math.round(y + step.y * bob),
                ARROWS[pointing],
              ),
            ]
          },
        })
      },
    }),
)
