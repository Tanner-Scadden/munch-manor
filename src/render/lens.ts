// The camera's lens: the one projection between the game's floor and the
// screen, both ways. The 3D renderer's camera (src/render/iso/lensCamera.ts),
// everything drawn over the world in 2D (src/render/camera.ts), the aim and
// the touch, culling, and the camera's view box all read a Lens built here,
// and no other module holds projection math or a tuned screen offset, so a
// marker sits on what it marks and up on a stick walks up the screen.
//
// The camera looks down at PITCH, turned YAW off north, through a slight
// perspective lens that sees FIELD_OF_VIEW from the view's top to its
// bottom, standing as far from the floor point at the view's middle as
// that takes. A game pixel on the floor there is one game pixel on the
// screen, as it was with the flat camera; nearer the lens things grow a
// little, and tall things lean out toward the screen's edges.
//
// NOTE: it runs per entity per frame, so it is plain scalar math. lensOf
// builds a frame's coefficients once (and keeps the last few), and a Lens's
// methods are closures over them: screenX and screenY return one number,
// and projectInto and unprojectInto write into the caller's own point, so
// asking for many points allocates nothing.

import { TILE_SIZE } from '../shared/constants'
import type { Vector } from '../world/schema/entitySchema'
import { PITCH, STRETCH, UNIT, type Vec3 } from './iso/space'

// NOTE: the turn off north, toward the west: the camera stands a little
// east of south, so walls, crates, and bodies show a sliver of their east
// faces beside their fronts, depth everywhere without the room tipping
// (owner's pick, 2026-11-15: 12 degrees tipped it too far, 5 by shots).
export const YAW = (5 * Math.PI) / 180

// NOTE: what the lens sees from the view's top to its bottom, the same on
// every layout: enough for tall things to lean at the edges, not so much
// that the room bends. A fixed distance instead let a phone held upright,
// whose view is taller, see 35 degrees to the desktop's 28 and read more
// tilted (owner, 2026-11-15).
const FIELD_OF_VIEW = (28 * Math.PI) / 180

// NOTE: the focal length in game pixels for a view this many rows tall: a
// game pixel at the view's middle stays a game pixel on the screen, so the
// lens stands this far off in game pixels (36 tiles on the desktop's 180
// rows, 46 on a phone held upright).
const focalFor = (rows: number): number =>
  rows / 2 / Math.tan(FIELD_OF_VIEW / 2)

// NOTE: from the floor toward the lens, and the screen's right and up in
// the world: the right lies flat on the floor, the up leans back with the
// pitch.
const TOWARD_X = Math.sin(YAW) * Math.cos(PITCH)
const TOWARD_Y = Math.sin(PITCH)
const TOWARD_Z = Math.cos(YAW) * Math.cos(PITCH)
const RIGHT_X = Math.cos(YAW)
const RIGHT_Z = -Math.sin(YAW)
const UP_X = -Math.sin(YAW) * Math.sin(PITCH)
const UP_Y = Math.cos(PITCH)
const UP_Z = -Math.cos(YAW) * Math.sin(PITCH)

// NOTE: a game pixel on the map in world units, across and down.
const PER_X = UNIT
const PER_Y = UNIT * STRETCH

// NOTE: the nearest a point may come to the lens's plane before it is held
// there, so a point behind the lens never flips across; and the shallowest
// a ray may drop, so a point at or over the horizon still lands on the
// floor, far off.
const NEAREST_DEPTH = 0.5
const SHALLOWEST_DROP = 0.05

// NOTE: a window on the game's map and where it sits on a canvas: x, y,
// width, and height in the game's pixels on the map (the lens looks at its
// middle), and scale, left, and top place the view on the canvas, so the
// view's middle lands at left + scale * width / 2. The game's Camera is one.
export type LensFrame = Readonly<{
  x: number
  y: number
  width: number
  height: number
  scale: number
  left: number
  top: number
}>

// NOTE: a point a caller keeps and reuses, for the calls that write one.
type PointOut = { x: number; y: number }

export type Lens = Readonly<{
  frame: LensFrame
  // NOTE: where the lens stands and the floor point it looks at, in world
  // units, and the vertical field of view in degrees a canvas this many
  // pixels tall sees: the 3D camera's settings.
  eye: Vec3
  lookedAt: Vec3
  fieldOfViewFor: (canvasHeightPx: number) => number
  // NOTE: a floor point on the map to the canvas, and back.
  screenX: (x: number, y: number) => number
  screenY: (x: number, y: number) => number
  projectInto: (x: number, y: number, out: PointOut) => PointOut
  unprojectInto: (screenX: number, screenY: number, out: PointOut) => PointOut
}>

const buildLens = (frame: LensFrame): Lens => {
  const { x, y, width, height, scale, left, top } = frame
  const lookX = (x + width / 2) * PER_X
  const lookZ = (y + height / 2) * PER_Y
  const focalPx = focalFor(height)
  const distance = focalPx / TILE_SIZE
  const eyeX = lookX + TOWARD_X * distance
  const eyeY = TOWARD_Y * distance
  const eyeZ = lookZ + TOWARD_Z * distance
  const focal = focalPx * scale
  const middleX = left + (scale * width) / 2
  const middleY = top + (scale * height) / 2

  // NOTE: across, up, and depth from the lens, each linear in the map's
  // x and y: c0 + cx * x + cy * y.
  const acrossX = RIGHT_X * PER_X
  const acrossY = RIGHT_Z * PER_Y
  const across0 = -(RIGHT_X * eyeX + RIGHT_Z * eyeZ)
  const upX = UP_X * PER_X
  const upY = UP_Z * PER_Y
  const up0 = -(UP_X * eyeX + UP_Y * eyeY + UP_Z * eyeZ)
  const depthX = -TOWARD_X * PER_X
  const depthY = -TOWARD_Z * PER_Y
  const depth0 = TOWARD_X * eyeX + TOWARD_Y * eyeY + TOWARD_Z * eyeZ

  const perspective = (mapX: number, mapY: number): number =>
    focal / Math.max(NEAREST_DEPTH, depth0 + depthX * mapX + depthY * mapY)
  const screenX = (mapX: number, mapY: number): number =>
    middleX +
    (across0 + acrossX * mapX + acrossY * mapY) * perspective(mapX, mapY)
  const screenY = (mapX: number, mapY: number): number =>
    middleY - (up0 + upX * mapX + upY * mapY) * perspective(mapX, mapY)

  return {
    frame,
    eye: { x: eyeX, y: eyeY, z: eyeZ },
    lookedAt: { x: lookX, y: 0, z: lookZ },
    fieldOfViewFor: canvasHeightPx =>
      (2 * Math.atan(canvasHeightPx / 2 / focal) * 180) / Math.PI,
    screenX,
    screenY,
    projectInto: (mapX, mapY, out) => {
      const each = perspective(mapX, mapY)
      out.x = middleX + (across0 + acrossX * mapX + acrossY * mapY) * each
      out.y = middleY - (up0 + upX * mapX + upY * mapY) * each
      return out
    },
    unprojectInto: (atX, atY, out) => {
      const across = (atX - middleX) / focal
      const down = (atY - middleY) / focal
      const rayX = -TOWARD_X + across * RIGHT_X - down * UP_X
      const rayY = -TOWARD_Y - down * UP_Y
      const rayZ = -TOWARD_Z + across * RIGHT_Z - down * UP_Z
      const reach = eyeY / Math.max(SHALLOWEST_DROP, -rayY)
      out.x = (eyeX + rayX * reach) / PER_X
      out.y = (eyeZ + rayZ * reach) / PER_Y
      return out
    },
  }
}

// NOTE: the last few lenses built, newest first: a frame asks for the
// overlay's, the world canvas's, and the 3D scene's again and again.
const KEPT_LENSES = 4
const kept: Array<Lens> = []

const isSameFrame = (a: LensFrame, b: LensFrame): boolean =>
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height &&
  a.scale === b.scale &&
  a.left === b.left &&
  a.top === b.top

export const lensOf = (frame: LensFrame): Lens => {
  for (const lens of kept) {
    if (lens.frame === frame || isSameFrame(lens.frame, frame)) {
      return lens
    }
  }
  const built = buildLens(frame)
  kept.unshift(built)
  if (kept.length > KEPT_LENSES) {
    kept.pop()
  }
  return built
}

// DIRECTIONS

// NOTE: a direction on the floor as the screen shows it at the view's
// middle, in game pixels: the lens's linear part there, a turn and a slight
// shear (the floor is stretched north to south, src/render/iso/space.ts).
// Its determinant is 1, so its inverse below is exact.
const ACROSS_OF_X = RIGHT_X
const ACROSS_OF_Y = (RIGHT_Z * PER_Y) / PER_X
const DOWN_OF_X = -UP_X
const DOWN_OF_Y = (-UP_Z * PER_Y) / PER_X
const DETERMINANT = ACROSS_OF_X * DOWN_OF_Y - ACROSS_OF_Y * DOWN_OF_X

// NOTE: a floor direction as the screen shows it, not normalized.
export const floorToScreenDirection = ({ x, y }: Vector): Vector => ({
  x: ACROSS_OF_X * x + ACROSS_OF_Y * y,
  y: DOWN_OF_X * x + DOWN_OF_Y * y,
})

// NOTE: kept to twelve places, so the float noise of the turn there and
// back never leaves a push straight along the floor's axis a hair off it,
// where a wall's edge would read it as across.
const PLACES = 1e12

const keptPlaces = (value: number): number =>
  Math.round(value * PLACES) / PLACES

// NOTE: a direction on the screen (a stick, the keys, a pad) as the floor
// direction under it, as long as it came in: up on the stick walks up the
// screen, and a half-pushed stick walks at half speed whichever way. A
// fixed map, the same on every device and every frame.
export const screenToFloorDirection = (direction: Vector): Vector => {
  const length = Math.hypot(direction.x, direction.y)
  const floorX =
    (DOWN_OF_Y * direction.x - ACROSS_OF_Y * direction.y) / DETERMINANT
  const floorY =
    (-DOWN_OF_X * direction.x + ACROSS_OF_X * direction.y) / DETERMINANT
  const floorLength = Math.hypot(floorX, floorY)
  return length === 0 || floorLength === 0
    ? { x: 0, y: 0 }
    : {
        x: keptPlaces((floorX * length) / floorLength),
        y: keptPlaces((floorY * length) / floorLength),
      }
}

// FLOOR SEEN

// NOTE: how many rows of the floor the lens shows above and below the
// view's middle, for a view this many rows tall: more above, where the
// floor is far off and small, and fewer below, where it is near and big.
// The lens looks the same everywhere on the map, so it rests on the height
// alone, and the camera stops at a level's edges by it.
export type FloorRowsSeen = Readonly<{ above: number; below: number }>

const seenByRows = new Map<number, FloorRowsSeen>()

export const floorRowsSeen = (rows: number): FloorRowsSeen => {
  const known = seenByRows.get(rows)
  if (known !== undefined) {
    return known
  }
  const lens = buildLens({
    x: 0,
    y: 0,
    width: rows,
    height: rows,
    scale: 1,
    left: 0,
    top: 0,
  })
  const middle = rows / 2
  const at = { x: 0, y: 0 }
  const top = lens.unprojectInto(middle, 0, at).y
  const bottom = lens.unprojectInto(middle, rows, at).y
  const seen = { above: middle - top, below: bottom - middle }
  seenByRows.set(rows, seen)
  return seen
}
