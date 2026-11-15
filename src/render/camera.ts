import { Function, Option } from 'effect'

import type { Model } from '../app/model'
import { couchFocus } from '../input/couch'
import {
  CAMERA_LEAN_PX,
  CAMERA_LEAN_RATE,
  CAMERA_LEAN_RETURN_RATE,
  MS_PER_SECOND,
} from '../shared/constants'
import { Finale } from '../world/dare/dareSchema'
import { type Level, levelOf } from '../world/level/arena'
import { focusOf } from '../world/party/party'
import type { Vector } from '../world/schema/entitySchema'
import {
  ZERO_VECTOR,
  clamp,
  clampLength,
  scaleVector,
} from '../world/step/geometry'
import { glideFocus } from './cine'
import { hudLayoutFor } from './hudLayout'
import { type Box, LANDSCAPE_SIZE, type Screen, screenOf } from './screen'

// CAMERA

// NOTE: x, y, width, and height are the part of the world the camera sees,
// in world pixels. scale, left, and top place it on a canvas: a world point
// lands at (point - x) * scale + left. The world canvas is the camera's own
// size, so there scale is 1 and left and top are 0. The overlay canvas holds
// the whole screen, where the world window sits below the HUD band and, in
// portrait, is zoomed in.
export type Camera = Readonly<{
  x: number
  y: number
  width: number
  height: number
  scale: number
  left: number
  top: number
}>

type WindowSize = Readonly<{ width: number; height: number }>

const followAxis = (
  focus: number,
  start: number,
  span: number,
  viewSpan: number,
): number =>
  span <= viewSpan
    ? start + Math.round((span - viewSpan) / 2)
    : start +
      Math.round(clamp(focus - start - viewSpan / 2, 0, span - viewSpan))

// NOTE: the camera is derived, not stored. It centers the window on the
// focus and stops at the edges of the level's open rooms, its bounds, and a
// level no bigger than the window sits centered and still. While the kitchen
// is shut the bounds are the parlour, so the camera never shows the rooms
// behind a boarded exit. The result is whole pixels, so the pixel art never
// lands between canvas pixels.
export const cameraFor: {
  (focus: Vector, window?: WindowSize): (level: Level) => Camera
  (level: Level, focus: Vector, window?: WindowSize): Camera
} = Function.dual(
  // NOTE: data-first starts with the level; data-last with the focus.
  (args: IArguments): boolean =>
    typeof args[0] === 'object' && 'tileFlags' in args[0],
  (
    level: Level,
    focus: Vector,
    window: WindowSize = LANDSCAPE_SIZE,
  ): Camera => ({
    x: followAxis(
      focus.x,
      level.bounds.left,
      level.bounds.right - level.bounds.left,
      window.width,
    ),
    y: followAxis(
      focus.y,
      level.bounds.top,
      level.bounds.bottom - level.bounds.top,
      window.height,
    ),
    width: window.width,
    height: window.height,
    scale: 1,
    left: 0,
    top: 0,
  }),
)

// NOTE: players sharing one keyboard share one camera, on the middle of
// them all (src/input/couch.ts).
export const cameraFocus = (model: Model): Vector =>
  Option.getOrElse(couchFocus(model), () => ({
    x: focusOf(model).player.x + model.cameraLean.x,
    y: focusOf(model).player.y + model.cameraLean.y,
  }))

// NOTE: the part of the world the window shows, in world pixels. A zoomed
// portrait window is taller on the screen than the room's height, and shows
// that full height across fewer of the room's pixels.
export const worldWindowOf = (screen: Screen): WindowSize => ({
  width: Math.round(screen.world.width / screen.zoom),
  height: Math.round(screen.world.height / screen.zoom),
})

// NOTE: the gun slots' key caps stand this far over the slots.
const KEY_CAP_RISE_PX = 3

// NOTE: how many world pixels at the bottom of the window the gun cluster
// covers: in landscape it sits over the world, in portrait under it, in the
// thumb area, where it covers none.
const clusterReserveOf = (screen: Screen): number =>
  Math.max(
    0,
    Math.ceil(
      (screen.world.y +
        screen.world.height -
        (hudLayoutFor(screen).slotTop - KEY_CAP_RISE_PX)) /
        screen.zoom,
    ),
  )

// NOTE: the finale plays at the front door, in the dining room's bottom
// wall, right where the gun cluster sits over the world in landscape. Once
// Uncle Chunk is summoned, the camera may follow on past the bottom of the
// house by what the cluster covers, onto the night outside, so the door,
// its padlock and bar, and the walk out stay above the slots. Before the
// finale and in portrait the camera keeps to the house.
const isFinaleOn = (model: Model): boolean =>
  !Finale.isAnyOf(['Hunting'])(model.dare.finale)

const finaleLevelOf = (model: Model, screen: Screen): Level => {
  const level = levelOf(model)
  const reserve = isFinaleOn(model) ? clusterReserveOf(screen) : 0
  return reserve === 0
    ? level
    : {
        ...level,
        bounds: { ...level.bounds, bottom: level.bounds.bottom + reserve },
      }
}

export const worldCameraFor: {
  (screen: Screen): (model: Model) => Camera
  (model: Model, screen: Screen): Camera
} = Function.dual(2, (model: Model, screen: Screen): Camera => {
  const window = worldWindowOf(screen)
  return cameraFor(
    finaleLevelOf(model, screen),
    glideFocus({ model, focus: cameraFocus(model), window }),
    window,
  )
})

export const toScreenCamera: {
  (screen: Screen): (camera: Camera) => Camera
  (camera: Camera, screen: Screen): Camera
} = Function.dual(2, (camera: Camera, screen: Screen): Camera => ({
  ...camera,
  scale: screen.zoom,
  left: screen.world.x,
  top: screen.world.y,
}))

// NOTE: the world camera places the world inside the world window, which is
// the whole screen in landscape. The screen camera places it on the overlay
// canvas, which in portrait also holds the HUD band above the window.
export const cameraOf = (model: Model): Camera =>
  worldCameraFor(model, screenOf(model))

export const screenCameraOf = (model: Model): Camera => {
  const screen = screenOf(model)
  return toScreenCamera(worldCameraFor(model, screen), screen)
}

export const worldToView: {
  (point: Vector): (camera: Camera) => Vector
  (camera: Camera, point: Vector): Vector
} = Function.dual(2, (camera: Camera, point: Vector): Vector => ({
  x: (point.x - camera.x) * camera.scale + camera.left,
  y: (point.y - camera.y) * camera.scale + camera.top,
}))

export const viewToWorld: {
  (point: Vector): (camera: Camera) => Vector
  (camera: Camera, point: Vector): Vector
} = Function.dual(2, (camera: Camera, point: Vector): Vector => ({
  x: (point.x - camera.left) / camera.scale + camera.x,
  y: (point.y - camera.top) / camera.scale + camera.y,
}))

// NOTE: where the camera's view sits on its canvas, in that canvas's pixels.
export const viewBoxOf = (camera: Camera): Box => ({
  x: camera.left,
  y: camera.top,
  width: camera.width * camera.scale,
  height: camera.height * camera.scale,
})

export const sceneOffset: {
  (shake: Vector): (camera: Camera) => Vector
  (camera: Camera, shake: Vector): Vector
} = Function.dual(2, (camera: Camera, shake: Vector): Vector =>
  worldToView(camera, shake),
)

// LEAN

// NOTE: within this of its target the lean lands on it, a quarter of a
// world pixel, below what the whole pixel camera can show.
const LEAN_SETTLE_PX = 0.25

// NOTE: the share of the way to a target a rate per second closes in
// deltaMs, the same at any frame rate: two 8 ms frames close what one 16 ms
// frame does.
const easeShareOf: {
  (deltaMs: number): (ratePerSecond: number) => number
  (ratePerSecond: number, deltaMs: number): number
} = Function.dual(
  2,
  (ratePerSecond: number, deltaMs: number): number =>
    1 - Math.exp((-ratePerSecond * Math.max(0, deltaMs)) / MS_PER_SECOND),
)

// NOTE: the camera leans toward where the player aims, by how hard they
// aim (aimReachOf in src/input/input.ts), up to CAMERA_LEAN_PX. It eases
// quickly toward an aim and slowly home once the aim is let go, so a flick
// of the stick or a lifted thumb does not jerk the view. The lean is stored
// in the Model because each frame's lean depends on the last.
export const leanCamera: {
  (maybeReach: Option.Option<Vector>, deltaMs: number): (lean: Vector) => Vector
  (lean: Vector, maybeReach: Option.Option<Vector>, deltaMs: number): Vector
} = Function.dual(
  3,
  (
    lean: Vector,
    maybeReach: Option.Option<Vector>,
    deltaMs: number,
  ): Vector => {
    const target = Option.match(maybeReach, {
      onNone: () => ZERO_VECTOR,
      onSome: reach => scaleVector(clampLength(reach, 1), CAMERA_LEAN_PX),
    })
    const share = easeShareOf(
      Option.isSome(maybeReach) ? CAMERA_LEAN_RATE : CAMERA_LEAN_RETURN_RATE,
      deltaMs,
    )
    const next = {
      x: lean.x + (target.x - lean.x) * share,
      y: lean.y + (target.y - lean.y) * share,
    }
    return Math.abs(next.x - target.x) < LEAN_SETTLE_PX &&
      Math.abs(next.y - target.y) < LEAN_SETTLE_PX
      ? target
      : next
  },
)
