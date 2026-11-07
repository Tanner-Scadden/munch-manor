import { Array, Function } from 'effect'
// Shelf packing: the items go in order of height, tallest first, left to
// right in rows as wide as the sheet, with a gutter between them. Sprites
// here are small and close in height, so shelves waste little, and the
// result depends only on the items' order, which the caller fixes.

export type Box<A> = Readonly<{ item: A; width: number; height: number }>

export type Packed<A> = Readonly<{
  width: number
  height: number
  placed: ReadonlyArray<Readonly<{ item: A; x: number; y: number }>>
}>

export const packShelves: {
  <A>(
    sheetWidth: number,
    gutter: number,
  ): (boxes: ReadonlyArray<Box<A>>) => Packed<A>
  <A>(
    boxes: ReadonlyArray<Box<A>>,
    sheetWidth: number,
    gutter: number,
  ): Packed<A>
} = Function.dual(
  3,
  <A>(
    boxes: ReadonlyArray<Box<A>>,
    sheetWidth: number,
    gutter: number,
  ): Packed<A> => {
    const ordered = Array.map(boxes, (box, index) => ({ box, index })).sort(
      (first, second) =>
        second.box.height - first.box.height ||
        second.box.width - first.box.width ||
        first.index - second.index,
    )
    const placed: Array<Readonly<{ item: A; x: number; y: number }>> = []
    let x = 0
    let y = 0
    let shelfHeight = 0
    let usedWidth = 0
    for (const { box } of ordered) {
      if (box.width > sheetWidth) {
        throw new Error(
          `a ${box.width} px wide sprite does not fit a ${sheetWidth} px sheet`,
        )
      }
      if (x > 0 && x + box.width > sheetWidth) {
        x = 0
        y += shelfHeight + gutter
        shelfHeight = 0
      }
      placed.push({ item: box.item, x, y })
      usedWidth = Math.max(usedWidth, x + box.width)
      x += box.width + gutter
      shelfHeight = Math.max(shelfHeight, box.height)
    }
    return {
      width: Math.max(1, usedWidth),
      height: Math.max(1, y + shelfHeight),
      placed,
    }
  },
)
