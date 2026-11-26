// NOTE: reading what a view draws in tests: a canvas shape tree's Rects
// and Images, and a rendered view's elements.

import { Array, Function, Match } from 'effect'

import { Locator } from '@effect/ui/testing'

import * as Draw from '../render/draw'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

type Edges = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

// NOTE: every Rect in a shape tree, moved by its Groups' translations.
export const rectsOf: {
  (
    offset: Readonly<{ x: number; y: number }>,
  ): (shapes: ReadonlyArray<Draw.Shape>) => ReadonlyArray<Draw.Rect & Box>
  (
    shapes: ReadonlyArray<Draw.Shape>,
    offset: Readonly<{ x: number; y: number }>,
  ): ReadonlyArray<Draw.Rect & Box>
} = Function.dual(
  2,
  (
    shapes: ReadonlyArray<Draw.Shape>,
    offset: Readonly<{ x: number; y: number }>,
  ): ReadonlyArray<Draw.Rect & Box> =>
    Array.flatMap(shapes, shape =>
      Match.value(shape).pipe(
        Match.tag('Group', group =>
          rectsOf(group.shapes, {
            x: offset.x + (group.translate?.x ?? 0),
            y: offset.y + (group.translate?.y ?? 0),
          }),
        ),
        Match.tag('Rect', rect => [
          Draw.Rect({ ...rect, x: rect.x + offset.x, y: rect.y + offset.y }),
        ]),
        Match.orElse(() => []),
      ),
    ),
)

// NOTE: every Image and Rect a shape tree draws, as its edges on the canvas,
// through its Groups' translations and scales.
type Placing = Readonly<{ x: number; y: number; scale: number }>

const drawnBoxesAt = (
  shapes: ReadonlyArray<Draw.Shape>,
  at: Placing,
): ReadonlyArray<Edges> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Group', ({ shapes: inner, translate, scale }) =>
        drawnBoxesAt(inner, {
          x: at.x + (translate?.x ?? 0) * at.scale,
          y: at.y + (translate?.y ?? 0) * at.scale,
          scale: at.scale * (scale?.x ?? 1),
        }),
      ),
      Match.tag('Image', 'Rect', ({ x, y, width, height }) => [
        {
          left: at.x + x * at.scale,
          top: at.y + y * at.scale,
          right: at.x + (x + width) * at.scale,
          bottom: at.y + (y + height) * at.scale,
        },
      ]),
      Match.orElse(() => []),
    ),
  )

export const drawnBoxesOf = (
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Edges> => drawnBoxesAt(shapes, { x: 0, y: 0, scale: 1 })

// NOTE: whether two boxes overlap, edges touching not counted.
export const isOverBox =
  (box: Edges) =>
  (other: Edges): boolean =>
    box.left < other.right &&
    box.right > other.left &&
    box.top < other.bottom &&
    box.bottom > other.top

export const imagesIn = (
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Image> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Image', image => [image]),
      Match.tag('Group', ({ shapes: inner }) => imagesIn(inner)),
      Match.orElse(() => []),
    ),
  )

// NOTE: a rendered view's elements, as a Scene's `root` and Effect UI's
// locators read them (`Locator.Node`: tag, attrs, props, text, children).
export type ViewNode = Locator.Node

// NOTE: a rendered view and every element under it, depth first, the root
// included.
export const nodesOf = (root: ViewNode): ReadonlyArray<ViewNode> =>
  Locator.elements(root)
