import { Array, Order, pipe } from 'effect'

import type * as Draw from './draw'

type DepthRank = 'Prop' | 'Trap' | 'Pickup' | 'Zombie' | 'Player' | 'Glow'

const RANK_ORDER: Readonly<Record<DepthRank, number>> = {
  Prop: 0,
  Trap: 1,
  Pickup: 2,
  Zombie: 3,
  Player: 4,
  Glow: 5,
}

export type Drawable = Readonly<{
  footY: number
  rank: DepthRank
  shapes: ReadonlyArray<Draw.Shape>
}>

const byDepth: Order.Order<Drawable> = Order.combine(
  Order.mapInput(Order.Number, ({ footY }: Drawable) => footY),
  Order.mapInput(Order.Number, ({ rank }: Drawable) => RANK_ORDER[rank]),
)

const GLOW_NEARER_PX = 1

export const glowOn = ({
  bodyFootY,
  shapes,
}: Readonly<{
  bodyFootY: number
  shapes: ReadonlyArray<Draw.Shape>
}>): Drawable => ({
  footY: bodyFootY + GLOW_NEARER_PX,
  rank: 'Glow',
  shapes,
})

export const TALL_MOST = 6

export const ON_FRONT_PX = 1

export const depthSortedShapes = (
  drawables: ReadonlyArray<Drawable>,
): ReadonlyArray<Draw.Shape> =>
  pipe(
    drawables,
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
