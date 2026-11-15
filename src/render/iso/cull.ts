// What the camera sees of the house, and whether a thing lies near enough to
// it to matter this frame. The house is about three screens wide once every
// room is open, and pixi draws whatever is in its scene into every casting
// light's shadow map whether the camera sees it or not, so what lies well
// off screen is left out of the frame.

import { Function } from 'effect'

import { type LensFrame, lensOf } from '../lens'

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

// NOTE: the floor the camera shows, boxed on the game's map: the floor
// points under the view's four corners through the lens
// (src/render/lens.ts), which turns the view and widens it away from the
// camera.
export const viewBoxOf = (frame: LensFrame): ViewBox => {
  const lens = lensOf(frame)
  const left = frame.left
  const top = frame.top
  const right = left + frame.width * frame.scale
  const bottom = top + frame.height * frame.scale
  const topLeft = lens.unprojectInto(left, top, { x: 0, y: 0 })
  const topRight = lens.unprojectInto(right, top, { x: 0, y: 0 })
  const bottomLeft = lens.unprojectInto(left, bottom, { x: 0, y: 0 })
  const bottomRight = lens.unprojectInto(right, bottom, { x: 0, y: 0 })
  return {
    left: Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
    right: Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    bottom: Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
  }
}

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
