import { Array, Order, pipe } from 'effect'

import type * as Draw from './draw'

// DRAWABLE

// NOTE: `Glow` is what shines of itself on a body's own plane, a muzzle
// flash and the knife's slash, drawn after the body it stands with.
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
  shapes: ReadonlyArray<Draw.Shape>
}>): Drawable => ({
  footY: bodyFootY + GLOW_NEARER_PX,
  rank: 'Glow',
  shapes,
})

// NOTE: how many blocks deep a piece of furniture is carved at most in the
// 3D world.
export const TALL_MOST = 6

// NOTE: a piece standing upright (`isUpright`) has its front straight up
// over its foot; what is drawn on it every frame (the hearth's fire, the
// stove's window, the fridge's door, the hatch in the sideboard) stands
// upright too, a pixel in front of it.
export const ON_FRONT_PX = 1

export const depthSortedShapes = (
  drawables: ReadonlyArray<Drawable>,
): ReadonlyArray<Draw.Shape> =>
  pipe(
    drawables,
    Array.sort(byDepth),
    Array.flatMap(({ shapes }) => shapes),
  )
