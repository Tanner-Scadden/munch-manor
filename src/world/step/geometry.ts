import { Function, Option } from 'effect'

import { KNOCKBACK_REST_SPEED } from '../../shared/constants'
import type { Vector } from '../schema/entitySchema'

export const ZERO_VECTOR: Vector = { x: 0, y: 0 }

// NOTE: the four ways on screen, y down, and a unit step each way: an
// arrow's bob and a controller's focus step in a menu.
export type ScreenDirection = 'Up' | 'Down' | 'Left' | 'Right'

export const SCREEN_STEPS: Readonly<Record<ScreenDirection, Vector>> = {
  Up: { x: 0, y: -1 },
  Down: { x: 0, y: 1 },
  Left: { x: -1, y: 0 },
  Right: { x: 1, y: 0 },
}

// NOTE: the way to push when two things sit on the same spot.
export const OUTWARD: Vector = { x: 1, y: 0 }

export const vectorLength = ({ x, y }: Vector): number => Math.hypot(x, y)

export const scaleVector: {
  (factor: number): (self: Vector) => Vector
  (self: Vector, factor: number): Vector
} = Function.dual(2, ({ x, y }: Vector, factor: number): Vector => ({
  x: x * factor,
  y: y * factor,
}))

export const addVectors: {
  (second: Vector): (first: Vector) => Vector
  (first: Vector, second: Vector): Vector
} = Function.dual(2, (first: Vector, second: Vector): Vector => ({
  x: first.x + second.x,
  y: first.y + second.y,
}))

export const clampLength: {
  (maxLength: number): (vector: Vector) => Vector
  (vector: Vector, maxLength: number): Vector
} = Function.dual(2, (vector: Vector, maxLength: number): Vector => {
  const length = vectorLength(vector)
  if (length > maxLength) {
    return scaleVector(vector, maxLength / length)
  } else {
    return vector
  }
})

export const normalize = (vector: Vector): Option.Option<Vector> => {
  const length = vectorLength(vector)
  if (length > 0) {
    return Option.some(scaleVector(vector, 1 / length))
  } else {
    return Option.none()
  }
}

export const directionBetween: {
  (to: Vector): (from: Vector) => Option.Option<Vector>
  (from: Vector, to: Vector): Option.Option<Vector>
} = Function.dual(2, (from: Vector, to: Vector): Option.Option<Vector> =>
  normalize({ x: to.x - from.x, y: to.y - from.y }),
)

export const distanceBetween: {
  (to: Vector): (from: Vector) => number
  (from: Vector, to: Vector): number
} = Function.dual(2, (from: Vector, to: Vector): number =>
  Math.hypot(to.x - from.x, to.y - from.y),
)

// NOTE: the point `t` of the way from `from` to `to`.
export const lerp: {
  (to: number, t: number): (from: number) => number
  (from: number, to: number, t: number): number
} = Function.dual(
  3,
  (from: number, to: number, t: number): number => from + (to - from) * t,
)

export const clamp: {
  (min: number, max: number): (value: number) => number
  (value: number, min: number, max: number): number
} = Function.dual(3, (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value)),
)

// NOTE: a share of 0 to 1 eased out, fast at first and settling.
export const easeOut = (share: number): number => 1 - (1 - share) * (1 - share)

export const circlesOverlap: {
  (
    firstRadius: number,
    second: Vector,
    secondRadius: number,
  ): (first: Vector) => boolean
  (
    first: Vector,
    firstRadius: number,
    second: Vector,
    secondRadius: number,
  ): boolean
} = Function.dual(
  4,
  (
    first: Vector,
    firstRadius: number,
    second: Vector,
    secondRadius: number,
  ): boolean => {
    const reach = firstRadius + secondRadius
    const deltaX = first.x - second.x
    const deltaY = first.y - second.y
    return deltaX * deltaX + deltaY * deltaY <= reach * reach
  },
)

export const closestPointOnSegment: {
  (from: Vector, to: Vector): (point: Vector) => Vector
  (point: Vector, from: Vector, to: Vector): Vector
} = Function.dual(3, (point: Vector, from: Vector, to: Vector): Vector => {
  const segmentX = to.x - from.x
  const segmentY = to.y - from.y
  const lengthSquared = segmentX * segmentX + segmentY * segmentY
  if (lengthSquared <= 0) {
    return from
  }

  const along = clamp(
    ((point.x - from.x) * segmentX + (point.y - from.y) * segmentY) /
      lengthSquared,
    0,
    1,
  )
  return { x: from.x + segmentX * along, y: from.y + segmentY * along }
})

// NOTE: a timer's time left after a frame, never below zero.
export const countDown: {
  (deltaMs: number): (remainingMs: number) => number
  (remainingMs: number, deltaMs: number): number
} = Function.dual(2, (remainingMs: number, deltaMs: number): number =>
  Math.max(0, remainingMs - deltaMs),
)

export const decayKnockback: {
  (decayPerSecond: number, seconds: number): (knockback: Vector) => Vector
  (knockback: Vector, decayPerSecond: number, seconds: number): Vector
} = Function.dual(
  3,
  (knockback: Vector, decayPerSecond: number, seconds: number): Vector => {
    const decayed = scaleVector(knockback, Math.exp(-decayPerSecond * seconds))
    if (vectorLength(decayed) < KNOCKBACK_REST_SPEED) {
      return ZERO_VECTOR
    } else {
      return decayed
    }
  },
)

// NOTE: a point inside a box, its left and top edges in, its right and
// bottom out.
export const isInsideBox: {
  (
    box: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  ): (position: Vector) => boolean
  (
    position: Vector,
    box: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  ): boolean
} = Function.dual(
  2,
  (
    { x, y }: Vector,
    {
      left,
      top,
      right,
      bottom,
    }: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  ): boolean => x >= left && x < right && y >= top && y < bottom,
)
