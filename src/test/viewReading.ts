// NOTE: reading what a view draws in tests: a canvas shape tree's Rects
// and Images, and a rendered VNode's elements.

import { Array, Function, Match } from 'effect'
import { Canvas } from 'foldkit'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

// NOTE: every Rect in a shape tree, moved by its Groups' translations.
export const rectsOf: {
  (
    offset: Readonly<{ x: number; y: number }>,
  ): (shapes: ReadonlyArray<Canvas.Shape>) => ReadonlyArray<Canvas.Rect & Box>
  (
    shapes: ReadonlyArray<Canvas.Shape>,
    offset: Readonly<{ x: number; y: number }>,
  ): ReadonlyArray<Canvas.Rect & Box>
} = Function.dual(
  2,
  (
    shapes: ReadonlyArray<Canvas.Shape>,
    offset: Readonly<{ x: number; y: number }>,
  ): ReadonlyArray<Canvas.Rect & Box> =>
    Array.flatMap(shapes, shape =>
      Match.value(shape).pipe(
        Match.tag('Group', group =>
          rectsOf(group.shapes, {
            x: offset.x + (group.translate?.x ?? 0),
            y: offset.y + (group.translate?.y ?? 0),
          }),
        ),
        Match.tag('Rect', rect => [
          Canvas.Rect({ ...rect, x: rect.x + offset.x, y: rect.y + offset.y }),
        ]),
        Match.orElse(() => []),
      ),
    ),
)

export const imagesIn = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Image> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Image', image => [image]),
      Match.tag('Group', ({ shapes: inner }) => imagesIn(inner)),
      Match.orElse(() => []),
    ),
  )

export type VNodeLike = Readonly<{
  sel?: string | undefined
  key?: PropertyKey | undefined
  data?:
    | Readonly<{
        attrs?: Readonly<Record<string, unknown>> | undefined
        props?: Readonly<Record<string, unknown>> | undefined
      }>
    | undefined
  children?: ReadonlyArray<VNodeLike | string> | undefined
}>

// NOTE: a rendered VNode and every element under it, depth first.
export const nodesOf = (root: VNodeLike): ReadonlyArray<VNodeLike> => {
  const found: Array<VNodeLike> = []
  const visit = (node: VNodeLike | string) => {
    if (typeof node === 'string') {
      return
    }
    found.push(node)
    Array.forEach(node.children ?? [], visit)
  }
  visit(root)
  return found
}
