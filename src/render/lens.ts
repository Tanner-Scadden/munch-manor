import { TILE_SIZE } from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import type { Vector } from '#world/schema/entitySchema.ts'

import { PITCH, STRETCH, UNIT, type Vec3 } from './iso/space.ts'

export const YAW = (5 * Math.PI) / 180

const FIELD_OF_VIEW = (28 * Math.PI) / 180

const focalFor = (rows: number): number =>
  rows / 2 / DetMath.tan(FIELD_OF_VIEW / 2)

const TOWARD_X = DetMath.sin(YAW) * DetMath.cos(PITCH)
const TOWARD_Y = DetMath.sin(PITCH)
const TOWARD_Z = DetMath.cos(YAW) * DetMath.cos(PITCH)
const RIGHT_X = DetMath.cos(YAW)
const RIGHT_Z = -DetMath.sin(YAW)
const UP_X = -DetMath.sin(YAW) * DetMath.sin(PITCH)
const UP_Y = DetMath.cos(PITCH)
const UP_Z = -DetMath.cos(YAW) * DetMath.sin(PITCH)

const PER_X = UNIT
const PER_Y = UNIT * STRETCH

const NEAREST_DEPTH = 0.5
const SHALLOWEST_DROP = 0.05

export type LensFrame = Readonly<{
  x: number
  y: number
  width: number
  height: number
  scale: number
  left: number
  top: number
}>

type PointOut = { x: number; y: number }

export type Lens = Readonly<{
  frame: LensFrame
  eye: Vec3
  lookedAt: Vec3
  fieldOfViewFor: (canvasHeightPx: number) => number
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
      (2 * DetMath.atan(canvasHeightPx / 2 / focal) * 180) / Math.PI,
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

const ACROSS_OF_X = RIGHT_X
const ACROSS_OF_Y = (RIGHT_Z * PER_Y) / PER_X
const DOWN_OF_X = -UP_X
const DOWN_OF_Y = (-UP_Z * PER_Y) / PER_X
const DETERMINANT = ACROSS_OF_X * DOWN_OF_Y - ACROSS_OF_Y * DOWN_OF_X

export const floorToScreenDirection = ({ x, y }: Vector): Vector => ({
  x: ACROSS_OF_X * x + ACROSS_OF_Y * y,
  y: DOWN_OF_X * x + DOWN_OF_Y * y,
})

const PLACES = 1e12

const keptPlaces = (value: number): number =>
  Math.round(value * PLACES) / PLACES

export const screenToFloorDirection = (direction: Vector): Vector => {
  const length = DetMath.hypot(direction.x, direction.y)
  const floorX =
    (DOWN_OF_Y * direction.x - ACROSS_OF_Y * direction.y) / DETERMINANT
  const floorY =
    (-DOWN_OF_X * direction.x + ACROSS_OF_X * direction.y) / DETERMINANT
  const floorLength = DetMath.hypot(floorX, floorY)
  return length === 0 || floorLength === 0
    ? { x: 0, y: 0 }
    : {
        x: keptPlaces((floorX * length) / floorLength),
        y: keptPlaces((floorY * length) / floorLength),
      }
}

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
