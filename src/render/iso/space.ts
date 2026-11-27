import { Array, Function, Option, Record, String } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import {
  DOOR_SYMBOLS,
  OUTSIDE_SYMBOL,
  WALL_SYMBOL,
} from '#world/level/tileGrid.ts'

export const UNIT = 1 / TILE_SIZE

export const PITCH = (49 * Math.PI) / 180

export const STRETCH = 1 / Math.sin(PITCH)

export const zOf = (gameY: number): number => gameY * UNIT * STRETCH

export const UP_NORMAL: readonly [number, number, number] = [0, 1, 0]
export const SOUTH_NORMAL: readonly [number, number, number] = [0, 0, 1]

export const OVERHEAD_FOOT_PX = 2

export const WALL_ROW = UNIT / Math.cos(PITCH)

export const WALL_FACE_ROWS = 9

const WALL_HEIGHT = WALL_FACE_ROWS * WALL_ROW

export const FRONT_WALL_ROWS = 2
const FRONT_WALL_HEIGHT = FRONT_WALL_ROWS * WALL_ROW
const FRONT_WALL_DEPTH = 2
const DOORWAY_ROWS = 2

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

const isSideWallAt = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
): boolean =>
  !Option.contains(symbolAt(tiles, row, column - 1), WALL_SYMBOL) ||
  !Option.contains(symbolAt(tiles, row, column + 1), WALL_SYMBOL)

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

const stepsOf = (whole: number): ReadonlyArray<number> =>
  Array.filter(Array.range(1, whole), step => Number.isInteger(whole / step))

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
