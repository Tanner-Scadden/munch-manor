// What the camera sees of the house, and whether a thing lies near enough to
// it to matter this frame. The house is about three screens wide once every
// room is open, and pixi draws whatever is in its scene into every casting
// light's shadow map whether the camera sees it or not, so what lies well
// off screen is left out of the frame.

import { Function } from 'effect'

// NOTE: a box on the game's map, in game pixels.
export type ViewBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

// NOTE: how far past the view a thing still shows or darkens it, in game
// pixels: what stands below the view's south edge rises into it (a wall, a
// tall piece), and a shadow falls a little way from what casts it.
const VIEW_MARGIN = 48

// NOTE: the floor the camera shows, from its top left corner and the game
// pixels it shows across and down.
export const viewBoxOf = (
  input: Readonly<{ x: number; y: number; width: number; height: number }>,
): ViewBox => ({
  left: input.x,
  top: input.y,
  right: input.x + input.width,
  bottom: input.y + input.height,
})

// NOTE: whether a box lies on the view or within its margin.
export const isNearView: {
  (view: ViewBox): (box: ViewBox) => boolean
  (box: ViewBox, view: ViewBox): boolean
} = Function.dual(
  2,
  (box: ViewBox, view: ViewBox): boolean =>
    box.left <= view.right + VIEW_MARGIN &&
    box.right >= view.left - VIEW_MARGIN &&
    box.top <= view.bottom + VIEW_MARGIN &&
    box.bottom >= view.top - VIEW_MARGIN,
)
