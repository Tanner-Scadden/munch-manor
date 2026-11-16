// The 3D world's space: how the game's 2D world maps onto 3D units.

import { Array, Function, Option, Record, String } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import {
  DOOR_SYMBOLS,
  OUTSIDE_SYMBOL,
  WALL_SYMBOL,
} from '../../world/level/tileGrid'

// NOTE: one world unit is one tile. A game pixel is a tenth of a unit, x runs
// east and z runs south (the game's y), and y is up.
export const UNIT = 1 / TILE_SIZE

// NOTE: the camera looks down at 49 degrees: low enough that what stands
// shows its fronts and its volume, high enough that the floor's tops stay
// readable (owner, 2026-11-14). It is turned a little off north and looks
// through a slight perspective lens (src/render/lens.ts).
export const PITCH = (49 * Math.PI) / 180

// NOTE: square pixels. A floor seen at a slant is squashed (by sin PITCH),
// while a billboard stands square to the pitch, so floor pixels and sprite
// pixels would come out different heights. The world is stretched
// north-south by the inverse, so a game pixel on the floor is as tall on the
// screen as one on a sprite. The lens (src/render/lens.ts) places every
// floor point for the 3D camera, the overlay, and the aim alike.
export const STRETCH = 1 / Math.sin(PITCH)

export const zOf = (gameY: number): number => gameY * UNIT * STRETCH

// NOTE: the world's axes a face is turned to, as normals: straight up, and
// south, out of a north wall toward the lens.
export const UP_NORMAL: readonly [number, number, number] = [0, 1, 0]
export const SOUTH_NORMAL: readonly [number, number, number] = [0, 0, 1]

// NOTE: what floats overhead (the hung chandelier, sparks) stands on the
// floor this many game pixels south of its own bottom edge.
export const OVERHEAD_FOOT_PX = 2

// NOTE: how tall one row of a wall's art stands on an upright face, so it
// is one game pixel on the screen as the floor's and a sprite's are: a face
// stands plumb, and the lens sees cos(PITCH) of its height.
export const WALL_ROW = UNIT / Math.cos(PITCH)

// NOTE: how many rows of a wall's art a tall wall's face stands, a row a
// screen pixel: the house's height, tall enough that the walls read as
// walls and low enough that the mantels and the shelves against them show
// whole (owner, 2026-11-15: a wall as tall as all its art hid them). The
// art over it runs on up its top as the 2D game drew it (wallQuads.ts).
export const WALL_FACE_ROWS = 9

const WALL_HEIGHT = WALL_FACE_ROWS * WALL_ROW

// NOTE: a wall with floor just north of it, through at most its own two
// tiles of thickness, stands between the lens and whoever is in that room,
// so it is built low for good, as the 2D game drew a room's front wall. It
// never moves: walls that dropped as the player walked by were not liked
// (owner, 2026-11-14). The side walls and the house's back walls stand tall,
// a side wall all the way down past its doorways: the floor north of a side
// wall's tile under a doorway is the doorway, wall again a tile or two up,
// not a room, so that tile is no front wall and the side wall keeps one
// height with one top where two rooms' walls meet. A front wall's face is
// its skirting's two rows.
export const FRONT_WALL_ROWS = 2
const FRONT_WALL_HEIGHT = FRONT_WALL_ROWS * WALL_ROW
const FRONT_WALL_DEPTH = 2
// NOTE: the most rows a doorway in a side wall opens (the ports and the
// spawn doors are two). A room's floor runs far longer north of its front
// wall.
const DOORWAY_ROWS = 2

// NOTE: the symbol of a tile of the map, by its row and column.
export const symbolAt: {
  (
    row: number,
    column: number,
  ): (tiles: ReadonlyArray<string>) => Option.Option<string>
  (
    tiles: ReadonlyArray<string>,
    row: number,
    column: number,
  ): Option.Option<string>
} = Function.dual(
  3,
  (
    tiles: ReadonlyArray<string>,
    row: number,
    column: number,
  ): Option.Option<string> => String.charAt(tiles[row] ?? '', column),
)

const DOORS: ReadonlyArray<string> = Record.values(DOOR_SYMBOLS)

// NOTE: where the 2D game drew a north wall's face, papered and paneled,
// over the two tiles of wall above it (roomWalls.ts `isNorthFace`): a wall
// tile over any tile of the map that is not wall or a doorway.
export const isNorthFaceAt = ({
  tiles,
  row,
  column,
}: Readonly<{
  tiles: ReadonlyArray<string>
  row: number
  column: number
}>): boolean =>
  Option.contains(symbolAt(tiles, row, column), WALL_SYMBOL) &&
  Option.exists(
    symbolAt(tiles, row + 1, column),
    symbol => symbol !== WALL_SYMBOL && !Array.contains(DOORS, symbol),
  )

// NOTE: a front wall two tiles thick that is also the back wall of the room
// south of it (the kitchen's, the dining room's top wall) stands its south
// tile, the face the room south of it sees, as tall as every top wall, so
// its paper and portraits stand up its face and do not lie folded over a
// low top (owner, 2026-11-15). Only its north tile stays low: the tall
// tile's top reaches back no further than that tile, so it hides none of
// the room behind.
export const isFrontWallAt = ({
  tiles,
  row,
  column,
}: Readonly<{
  tiles: ReadonlyArray<string>
  row: number
  column: number
}>): boolean => {
  if (
    isNorthFaceAt({ tiles, row, column }) &&
    Option.contains(symbolAt(tiles, row - 1, column), WALL_SYMBOL)
  ) {
    return false
  }
  for (let step = 1; step <= FRONT_WALL_DEPTH; step += 1) {
    const north = symbolAt(tiles, row - step, column)
    if (north._tag === 'None' || north.value === OUTSIDE_SYMBOL) {
      return false
    }
    if (north.value !== WALL_SYMBOL) {
      return !(
        isSideWallAt(tiles, row, column) &&
        isDoorwayAbove(tiles, row - step, column)
      )
    }
  }
  return false
}

// NOTE: a side wall's tile has no wall on one side of it, east or west,
// where a front wall runs on across the house with wall on both.
const isSideWallAt = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean =>
  !Option.contains(symbolAt(tiles, row, column - 1), WALL_SYMBOL) ||
  !Option.contains(symbolAt(tiles, row, column + 1), WALL_SYMBOL)

// NOTE: whether the open tiles from `row` north are a doorway: wall again
// within a doorway's rows.
const isDoorwayAbove = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean => {
  for (let step = 1; step <= DOORWAY_ROWS; step += 1) {
    if (Option.contains(symbolAt(tiles, row - step, column), WALL_SYMBOL)) {
      return true
    }
  }
  return false
}

// NOTE: where a standing sprite's "up" and "out" point in the world: every
// billboard faces south, leaned back square to the pitch, and a sprite's
// parts are offset from its foot along that up: that keeps the whole sprite
// at its foot's depth, which is exactly the game's foot sort, and keeps the
// parts of one body (a hat over a head, a gun in a hand) where the 2D game
// drew them. The frame stays with the house, not the lens: the lens is
// turned a little off it (src/render/lens.ts), so a carved body shows a
// sliver of its side beside its front.
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

// NOTE: the steps that keep a game pixel a whole number of canvas pixels:
// the whole numbers that divide it, smallest first.
const stepsOf = (whole: number): ReadonlyArray<number> =>
  Array.filter(Array.range(1, whole), step => Number.isInteger(whole / step))

// NOTE: how many device pixels each canvas pixel covers, across and down,
// for a game pixel of this many device pixels. The world is lit and drawn at
// about one canvas pixel per CSS pixel, not the device's full ratio: a 3x
// phone filled three million pixels with every light each frame and dropped
// frames (owner, 2026-11-14). The step is the largest whole number up to the
// ratio that divides the game pixel, so a game pixel is still a whole number
// of canvas pixels and each canvas pixel a square of device pixels: the art
// comes out the same, and only the light's gradients are coarser. A game
// pixel of 5 or 7 device pixels has no such step but 1, which drew the world
// at the device's full resolution, up to nine times the pixels: at a ratio
// of 2 or more it takes the smallest step over 1 instead, a canvas pixel to
// the game pixel for a prime.
export const canvasStepOf = ({
  devicePerGamePixel,
  ratio,
}: Readonly<{ devicePerGamePixel: number; ratio: number }>): number => {
  const whole = Math.max(1, Math.round(devicePerGamePixel))
  const steps = stepsOf(whole)
  const most = Math.max(1, Math.floor(ratio))
  const step = Option.getOrElse(
    Array.findLast(steps, candidate => candidate <= most),
    () => 1,
  )
  return step === 1 && most >= 2
    ? Option.getOrElse(
        Array.findFirst(steps, candidate => candidate > 1),
        () => 1,
      )
    : step
}

// NOTE: the step for a quality tier that draws at most a few canvas pixels
// to a game pixel (src/render/iso/quality.ts): the largest whole step that
// still leaves at least that many, or a canvas pixel per game pixel where a
// game pixel is that small already, and never finer than `canvasStepOf`.
export const scaledStepOf = ({
  devicePerGamePixel,
  ratio,
  perGamePixel,
}: Readonly<{
  devicePerGamePixel: number
  ratio: number
  perGamePixel: number
}>): number => {
  const whole = Math.max(1, Math.round(devicePerGamePixel))
  const scaled = Option.getOrElse(
    Array.findLast(stepsOf(whole), step => whole / step >= perGamePixel),
    () => 1,
  )
  return Math.max(scaled, canvasStepOf({ devicePerGamePixel, ratio }))
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
