import { Function, Option } from 'effect'

import { KNOCKBACK_REST_SPEED } from './constants'
import type { Vector } from './entitySchema'

export const ZERO_VECTOR: Vector = { x: 0, y: 0 }

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

export const clamp: {
  (min: number, max: number): (value: number) => number
  (value: number, min: number, max: number): number
} = Function.dual(3, (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value)),
)

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
