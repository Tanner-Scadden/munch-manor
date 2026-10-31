import { Option } from 'effect'

import { KNOCKBACK_REST_SPEED } from './constants'
import type { Vector } from './entitySchema'

export const ZERO_VECTOR: Vector = { x: 0, y: 0 }

// NOTE: the way to push when two things sit on the same spot.
export const OUTWARD: Vector = { x: 1, y: 0 }

export const vectorLength = ({ x, y }: Vector): number => Math.hypot(x, y)

export const scaleVector = ({ x, y }: Vector, factor: number): Vector => ({
  x: x * factor,
  y: y * factor,
})

export const addVectors = (first: Vector, second: Vector): Vector => ({
  x: first.x + second.x,
  y: first.y + second.y,
})

export const clampLength = (vector: Vector, maxLength: number): Vector => {
  const length = vectorLength(vector)
  if (length > maxLength) {
    return scaleVector(vector, maxLength / length)
  } else {
    return vector
  }
}

export const normalize = (vector: Vector): Option.Option<Vector> => {
  const length = vectorLength(vector)
  if (length > 0) {
    return Option.some(scaleVector(vector, 1 / length))
  } else {
    return Option.none()
  }
}

export const directionBetween = (
  from: Vector,
  to: Vector,
): Option.Option<Vector> => normalize({ x: to.x - from.x, y: to.y - from.y })

export const distanceBetween = (from: Vector, to: Vector): number =>
  Math.hypot(to.x - from.x, to.y - from.y)

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const circlesOverlap = (
  first: Vector,
  firstRadius: number,
  second: Vector,
  secondRadius: number,
): boolean => {
  const reach = firstRadius + secondRadius
  const deltaX = first.x - second.x
  const deltaY = first.y - second.y
  return deltaX * deltaX + deltaY * deltaY <= reach * reach
}

export const closestPointOnSegment = (
  point: Vector,
  from: Vector,
  to: Vector,
): Vector => {
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
}

// NOTE: a timer's time left after a frame, never below zero.
export const countDown = (remainingMs: number, deltaMs: number): number =>
  Math.max(0, remainingMs - deltaMs)

export const decayKnockback = (
  knockback: Vector,
  decayPerSecond: number,
  seconds: number,
): Vector => {
  const decayed = scaleVector(knockback, Math.exp(-decayPerSecond * seconds))
  if (vectorLength(decayed) < KNOCKBACK_REST_SPEED) {
    return ZERO_VECTOR
  } else {
    return decayed
  }
}
