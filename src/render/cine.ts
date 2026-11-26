import { Array, Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import { MS_PER_SECOND } from '#shared/constants.ts'
import { Finale } from '#world/dare/dareSchema.ts'
import { levelOf } from '#world/level/arena.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import { Boss } from '#world/schema/worldSchema.ts'
import {
  ZERO_VECTOR,
  addVectors,
  clamp,
  smoothStep,
} from '#world/step/geometry.ts'

import type * as Draw from './draw.ts'
import { rect } from './drawing.ts'
import type { CameraGlide } from './renderSchema.ts'
import type { Box } from './screen.ts'

export const FINISHER_CINE_MS = 1100

const EASE_SHARE = 0.3

type Cine = Readonly<{ spot: Vector; weight: number }>

export const cineWeightOf = (progress: number): number => {
  const share = clamp(progress, 0, 1)
  return smoothStep(Math.min(1, share / EASE_SHARE, (1 - share) / EASE_SHARE))
}

const progressOf = (remainingMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : 1 - remainingMs / durationMs

const cinesOf = (model: Model): ReadonlyArray<Cine> => {
  const level = levelOf(model)
  return Array.getSomes([
    Finale.matchOrElse(
      model.dare.finale,
      {
        KeyFlying: ({ remainingMs, durationMs }): Option.Option<Cine> =>
          Option.some({
            spot: level.doors.Front.center,
            weight: cineWeightOf(progressOf(remainingMs, durationMs)),
          }),
      },
      () => Option.none(),
    ),
    Boss.matchOrElse(
      model.boss,
      {
        Arriving: ({ door, remainingMs, durationMs }): Option.Option<Cine> =>
          Option.some({
            spot: level.doors[door].center,
            weight: cineWeightOf(progressOf(remainingMs, durationMs)),
          }),
      },
      () => Option.none(),
    ),
    Option.map(model.maybeFinisher, ({ x, y, ageMs }) => ({
      spot: { x, y },
      weight: cineWeightOf(ageMs / FINISHER_CINE_MS),
    })),
  ])
}

export const isCineOn = (model: Model): boolean => cinesOf(model).length > 0

const KEEP_IN_VIEW_PX = 48

type Window = Readonly<{ width: number; height: number }>

const keptInView = (offset: Vector, window: Window): Vector => {
  const reachX = Math.max(0, window.width / 2 - KEEP_IN_VIEW_PX)
  const reachY = Math.max(0, window.height / 2 - KEEP_IN_VIEW_PX)
  return {
    x: clamp(offset.x, -reachX, reachX),
    y: clamp(offset.y, -reachY, reachY),
  }
}

export const cinePullOf = (
  input: Readonly<{ model: Model; focus: Vector; window: Window }>,
): Vector => {
  const { model, focus, window } = input
  return keptInView(
    Array.reduce(cinesOf(model), ZERO_VECTOR, (pull, { spot }) =>
      addVectors(
        pull,
        keptInView({ x: spot.x - focus.x, y: spot.y - focus.y }, window),
      ),
    ),
    window,
  )
}

const CINE_SPRING_RATE = 6

const SETTLE_PX = 0.25
const SETTLE_PX_PER_SECOND = 1

const springAxis = (
  offset: number,
  velocity: number,
  target: number,
  seconds: number,
): Readonly<{ offset: number; velocity: number }> => {
  const gap = offset - target
  const lead = velocity + CINE_SPRING_RATE * gap
  const decay = Math.exp(-CINE_SPRING_RATE * seconds)
  return {
    offset: target + (gap + lead * seconds) * decay,
    velocity: (velocity - CINE_SPRING_RATE * lead * seconds) * decay,
  }
}

export const glideCamera: {
  (pull: Vector, deltaMs: number): (glide: CameraGlide) => CameraGlide
  (glide: CameraGlide, pull: Vector, deltaMs: number): CameraGlide
} = Function.dual(
  3,
  (glide: CameraGlide, pull: Vector, deltaMs: number): CameraGlide => {
    const seconds = Math.max(0, deltaMs) / MS_PER_SECOND
    const x = springAxis(glide.offset.x, glide.velocity.x, pull.x, seconds)
    const y = springAxis(glide.offset.y, glide.velocity.y, pull.y, seconds)
    const isSettled =
      Math.abs(x.offset - pull.x) < SETTLE_PX &&
      Math.abs(y.offset - pull.y) < SETTLE_PX &&
      Math.hypot(x.velocity, y.velocity) < SETTLE_PX_PER_SECOND
    const isAtRest =
      isSettled &&
      Object.is(glide.offset.x, pull.x) &&
      Object.is(glide.offset.y, pull.y) &&
      glide.velocity === ZERO_VECTOR
    return isAtRest
      ? glide
      : isSettled
        ? { offset: pull, velocity: ZERO_VECTOR }
        : {
            offset: { x: x.offset, y: y.offset },
            velocity: { x: x.velocity, y: y.velocity },
          }
  },
)

export const glideFocus = (
  input: Readonly<{ model: Model; focus: Vector; window: Window }>,
): Vector => {
  const { model, focus, window } = input
  return addVectors(focus, keptInView(model.cameraGlide.offset, window))
}

const BAR_PX = 14
const BAR_FILL = '#07060a'

export const cineBarShapes = (
  input: Readonly<{ model: Model; world: Box }>,
): ReadonlyArray<Draw.Shape> => {
  const { model, world } = input
  const weight = Array.reduce(cinesOf(model), 0, (most, cine) =>
    Math.max(most, cine.weight),
  )
  const height = Math.round(BAR_PX * weight)
  return height <= 0
    ? []
    : [
        rect(world.x, world.y, world.width, height, BAR_FILL),
        rect(
          world.x,
          world.y + world.height - height,
          world.width,
          height,
          BAR_FILL,
        ),
      ]
}
