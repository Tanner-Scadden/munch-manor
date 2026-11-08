import { Array, Order, pipe } from 'effect'
import type { Canvas } from 'foldkit'

// DRAWABLE

type DepthRank = 'Wall' | 'Prop' | 'Trap' | 'Pickup' | 'Zombie' | 'Player'

const RANK_ORDER: Readonly<Record<DepthRank, number>> = {
  Wall: 0,
  Prop: 1,
  Trap: 2,
  Pickup: 3,
  Zombie: 4,
  Player: 5,
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

export const depthSortedShapes = (
  drawables: ReadonlyArray<Drawable>,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    drawables,
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
