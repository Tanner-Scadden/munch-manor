// The 3D world's space: how the game's 2D world maps onto 3D units.

import { Array, Option, String } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import { WALL_SYMBOL } from '../../world/level/tileGrid'

// NOTE: one world unit is one tile. A game pixel is a tenth of a unit, x runs
// east and z runs south (the game's y), and y is up.
export const UNIT = 1 / TILE_SIZE

// NOTE: the camera, looking straight north and down at 49 degrees: low
// enough that what stands shows its fronts and its volume, high enough that
// the floor's tops stay readable (owner, 2026-11-14).
export const PITCH = (49 * Math.PI) / 180

// NOTE: crisp pixels, and the 2D game's own map. A floor seen at a slant is
// squashed (by sin PITCH), while a billboard faces the lens square, so floor
// pixels and sprite pixels would come out different heights. The world is
// stretched north-south by the inverse, so a game pixel is square on screen
// on the floor too. The floor then projects exactly onto the game's 2D map:
// a camera locked to the game's own camera puts every floor point where the
// game aims, so the mouse, the touch aim, and the overlay's markers need
// nothing new.
export const STRETCH = 1 / Math.sin(PITCH)

export const zOf = (gameY: number): number => gameY * UNIT * STRETCH

// NOTE: what floats overhead (the hung chandelier, sparks) stands on the
// floor this many game pixels south of its own bottom edge.
export const OVERHEAD_FOOT_PX = 2

const WALL_HEIGHT = 1.4

// NOTE: a wall with floor just north of it, through at most its own two
// tiles of thickness, stands between the lens and whoever is in that room,
// so it is built low for good, as the 2D game drew a room's front wall. It
// never moves: walls that dropped as the player walked by were not liked
// (owner, 2026-11-14). The side walls and the house's back walls stand tall.
const FRONT_WALL_HEIGHT = 0.4
const FRONT_WALL_DEPTH = 2
const OUTSIDE = ','

export const isFrontWallAt = ({
  tiles,
  row,
  column,
}: Readonly<{
  tiles: ReadonlyArray<string>
  row: number
  column: number
}>): boolean => {
  for (let step = 1; step <= FRONT_WALL_DEPTH; step += 1) {
    const north = String.charAt(tiles[row - step] ?? '', column)
    if (north._tag === 'None' || north.value === OUTSIDE) {
      return false
    }
    if (north.value !== WALL_SYMBOL) {
      return true
    }
  }
  return false
}

// NOTE: where "up" and "toward the lens" point in the world. The camera
// looks straight north, so every billboard faces it square, and a sprite's
// parts are offset from its foot along the camera's own up: that keeps the
// whole sprite at its foot's depth, which is exactly the game's foot sort,
// and keeps the parts of one body (a hat over a head, a gun in a hand)
// where the 2D game drew them.
export type Vec3 = Readonly<{ x: number; y: number; z: number }>

export const CAMERA_UP: Vec3 = {
  x: 0,
  y: Math.cos(PITCH),
  z: -Math.sin(PITCH),
}

export const TOWARD_CAMERA: Vec3 = {
  x: 0,
  y: Math.sin(PITCH),
  z: Math.cos(PITCH),
}

// NOTE: the one way anything stands in the world: the game pixel at `x`,
// `atY` that a sprite standing on row `footY` draws, put up the camera's up
// from the floor at its foot, so it shows on the very pixel the 2D game drew
// it on, at its foot's depth; then `out` world units toward the lens, which
// moves it nearer without moving it on screen. Billboards, voxel bodies, and
// lights (a candle's, the muzzle flash's, the lamp) all stand through it, so
// what one body holds never drifts from it. Never place a standing thing
// with a hand-tuned height: give the pixel it draws on.
export const standingPointOf = (
  input: Readonly<{ x: number; footY: number; atY: number; out: number }>,
): Vec3 => {
  const rise = (input.footY - input.atY) * UNIT
  return {
    x: input.x * UNIT + CAMERA_UP.x * rise + TOWARD_CAMERA.x * input.out,
    y: CAMERA_UP.y * rise + TOWARD_CAMERA.y * input.out,
    z: zOf(input.footY) + CAMERA_UP.z * rise + TOWARD_CAMERA.z * input.out,
  }
}

// THE CANVAS'S PIXELS

// NOTE: how many device pixels each canvas pixel covers, across and down,
// for a game pixel of this many device pixels. The world is lit and drawn at
// about one canvas pixel per CSS pixel, not the device's full ratio: a 3x
// phone filled three million pixels with every light each frame and dropped
// frames (owner, 2026-11-14). The step is the largest whole number up to the
// ratio that divides the game pixel, so a game pixel is still a whole number
// of canvas pixels and each canvas pixel a square of device pixels: the art
// comes out the same, and only the light's gradients are coarser.
export const canvasStepOf = ({
  devicePerGamePixel,
  ratio,
}: Readonly<{ devicePerGamePixel: number; ratio: number }>): number => {
  const whole = Math.max(1, Math.round(devicePerGamePixel))
  const most = Math.max(1, Math.min(whole, Math.floor(ratio)))
  return Option.getOrElse(
    Array.findFirst(Array.reverse(Array.range(1, most)), step =>
      Number.isInteger(whole / step),
    ),
    () => 1,
  )
}

// NOTE: how tall the wall on a tile is, 0 for no wall.
export const wallHeightAt = (
  at: Readonly<{ tiles: ReadonlyArray<string>; row: number; column: number }>,
): number =>
  !Option.exists(
    String.charAt(at.tiles[at.row] ?? '', at.column),
    symbol => symbol === WALL_SYMBOL,
  )
    ? 0
    : isFrontWallAt(at)
      ? FRONT_WALL_HEIGHT
      : WALL_HEIGHT
