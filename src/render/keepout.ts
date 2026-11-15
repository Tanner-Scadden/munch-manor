import { Array, Option } from 'effect'

// What the art pinned over the world keeps out of, in screen pixels: the
// HUD's buttons and panels (src/screens/game/pocket.ts lists them), for
// Rattles' bubbles (src/screens/game/stallBubble.ts) and the shop's tags
// (src/features/shop/purchaseView.ts).

export type Keepout = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const KEEPOUT_GAP = 2

const isOverKeepout =
  (x: number, width: number, height: number, y: number) =>
  (keepout: Keepout): boolean =>
    x < keepout.right &&
    x + width > keepout.left &&
    y < keepout.bottom &&
    y + height > keepout.top

// NOTE: a box `width` by `height` at `x`, wanting its top at `y`, moved up
// or down only, between `top` and `bottom` (the highest and lowest tops it
// may take).
type Placing = Readonly<{
  keepouts: ReadonlyArray<Keepout>
  x: number
  y: number
  width: number
  height: number
  top: number
  bottom: number
}>

// NOTE: where the box wants to be, if that is clear; else the nearest top
// just under or just over one keepout that is clear of every one and
// between `top` and `bottom`; else, with nowhere clear, it steps past each
// keepout in turn.
export const clearOfKeepouts = ({
  keepouts,
  x,
  y,
  width,
  height,
  top,
  bottom,
}: Placing): number => {
  // NOTE: a handful of keepouts (the HUD's few panels and buttons, a
  // banner, a hint row or two), each against the others' candidates.
  const isClear = (placed: number): boolean =>
    !Array.some(keepouts, isOverKeepout(x, width, height, placed))
  if (isClear(y)) {
    return y
  }
  const nearest = Array.reduce(
    Array.flatMap(keepouts, keepout => [
      keepout.bottom + KEEPOUT_GAP,
      keepout.top - KEEPOUT_GAP - height,
    ]),
    Option.none<number>(),
    (best, candidate) =>
      candidate >= top &&
      candidate <= bottom &&
      isClear(candidate) &&
      Option.match(best, {
        onNone: () => true,
        onSome: kept => Math.abs(candidate - y) < Math.abs(kept - y),
      })
        ? Option.some(candidate)
        : best,
  )
  return Option.getOrElse(nearest, () =>
    Array.reduce(keepouts, y, (placed, keepout) => {
      if (!isOverKeepout(x, width, height, placed)(keepout)) {
        return placed
      }
      const under = keepout.bottom + KEEPOUT_GAP
      return under <= bottom
        ? under
        : Math.max(top, keepout.top - KEEPOUT_GAP - height)
    }),
  )
}
