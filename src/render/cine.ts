// The camera's big moments: as a wave's last zombie falls, as the boss
// comes through his door, and as Uncle Chunk's key flies to the front
// door, the camera glides partway toward the moment and back, and thin
// letterbox bars slide in over the world. The glide is a critically damped
// spring kept on the Model (`cameraGlide`): it eases in and out, never
// overshoots, and pulls toward every moment on at once, so one moment
// ending while another plays never jumps the view. There is no zoom: the camera
// still lands on whole pixels, so the art stays crisp (owner, 2026-11-14).
// The boss's and the key's moments are read off the World, so a co-op crew
// sees them together; the wave's is the client's own (`Finisher`).

import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../app/model'
import { MS_PER_SECOND } from '../shared/constants'
import { Finale } from '../world/dare/dareSchema'
import { levelOf } from '../world/level/arena'
import type { Vector } from '../world/schema/entitySchema'
import { Boss } from '../world/schema/worldSchema'
import {
  ZERO_VECTOR,
  addVectors,
  clamp,
  smoothStep,
} from '../world/step/geometry'
import { rect } from './drawing'
import type { CameraGlide } from './renderSchema'
import type { Box } from './screen'

// NOTE: how long the glide to a wave's last blow lasts, on the display's
// clock.
export const FINISHER_CINE_MS = 1100

// NOTE: the share of a moment the glide spends easing in, and easing out.
const EASE_SHARE = 0.3

type Cine = Readonly<{ spot: Vector; weight: number }>

// NOTE: 0 at a moment's start and end, 1 through its middle, eased.
export const cineWeightOf = (progress: number): number => {
  const share = clamp(progress, 0, 1)
  return smoothStep(Math.min(1, share / EASE_SHARE, (1 - share) / EASE_SHARE))
}

const progressOf = (remainingMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : 1 - remainingMs / durationMs

// NOTE: every moment on now: the key's flight, the boss at his door, and
// the wave's last blow.
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

// NOTE: how close to the window's edge the glide may bring the player, in
// world pixels, so the moment never takes them out of sight.
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

// NOTE: where the moments pull the camera, off its focus: toward each one
// on, as far as keeps the player in the window, all of them together held
// to that too. Nothing on pulls nowhere.
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

// NOTE: the spring's stiffness, per second. At 6 the glide covers four
// fifths of the way in half a second, at about half the old glide's top
// speed, and settles with no overshoot.
const CINE_SPRING_RATE = 6

// NOTE: within this of its pull and this slow, the glide lands on it.
const SETTLE_PX = 0.25
const SETTLE_PX_PER_SECOND = 1

// NOTE: one axis of a critically damped spring, solved exactly over the
// frame, so it moves the same at any frame rate.
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

// NOTE: the glide sprung one frame toward the moments' pull.
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
    return isSettled
      ? { offset: pull, velocity: ZERO_VECTOR }
      : {
          offset: { x: x.offset, y: y.offset },
          velocity: { x: x.velocity, y: y.velocity },
        }
  },
)

// NOTE: the camera's focus, glided toward the moments, never so far that
// the player leaves the window.
export const glideFocus = (
  input: Readonly<{ model: Model; focus: Vector; window: Window }>,
): Vector => {
  const { model, focus, window } = input
  return addVectors(focus, keptInView(model.cameraGlide.offset, window))
}

// BARS

// NOTE: the bars' height at full weight, in screen pixels, and their ink.
const BAR_PX = 14
const BAR_FILL = '#07060a'

// NOTE: the letterbox bars over the top and bottom of the world window,
// sliding in with the strongest moment's weight.
export const cineBarShapes = (
  input: Readonly<{ model: Model; world: Box }>,
): ReadonlyArray<Canvas.Shape> => {
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
