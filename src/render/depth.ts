import { Array, Order, pipe } from 'effect'
import type { Canvas } from 'foldkit'

// DRAWABLE

// NOTE: `Glow` is what shines of itself on a body's own plane, a muzzle
// flash and the knife's slash, drawn after the body it stands with.
type DepthRank =
  | 'Wall'
  | 'Prop'
  | 'Trap'
  | 'Pickup'
  | 'Zombie'
  | 'Player'
  | 'Glow'

const RANK_ORDER: Readonly<Record<DepthRank, number>> = {
  Wall: 0,
  Prop: 1,
  Trap: 2,
  Pickup: 3,
  Zombie: 4,
  Player: 5,
  Glow: 6,
}

export type Drawable = Readonly<{
  footY: number
  rank: DepthRank
  shapes: ReadonlyArray<Canvas.Shape>
}>

// NOTE: whatever stands nearer the bottom of the screen is nearer the viewer,
// so it draws later. Two drawables at the same foot draw by rank, and two of
// the same rank keep the order they came in, since the sort is stable.
const byDepth: Order.Order<Drawable> = Order.combine(
  Order.mapInput(Order.Number, ({ footY }: Drawable) => footY),
  Order.mapInput(Order.Number, ({ rank }: Drawable) => RANK_ORDER[rank]),
)

// NOTE: what glows on a body (`Glow`) stands on that body's own plane, so
// in 3D it moves with the body at any angle; a pixel nearer the lens, so the
// body's own front blocks never cover it.
const GLOW_NEARER_PX = 1

export const glowOn = ({
  bodyFootY,
  shapes,
}: Readonly<{
  bodyFootY: number
  shapes: ReadonlyArray<Canvas.Shape>
}>): Drawable => ({
  footY: bodyFootY + GLOW_NEARER_PX,
  rank: 'Glow',
  shapes,
})

export const depthSortedShapes = (
  drawables: ReadonlyArray<Drawable>,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    drawables,
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
