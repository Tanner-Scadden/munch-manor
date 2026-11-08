import { Function, Option } from 'effect'

import type { Model, Vector } from '../app/model'
import { couchFocus } from '../features/couch/couch'
import { CAMERA_LEAN_EASE_MS, CAMERA_LEAN_PX } from '../shared/constants'
import { type Level, levelOf } from '../world/level/arena'
import { focusOf } from '../world/party/party'
import { ZERO_VECTOR, clamp, scaleVector } from '../world/step/geometry'
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
// them all (src/features/couch/couch.ts).
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

export const worldCameraFor: {
  (screen: Screen): (model: Model) => Camera
  (model: Model, screen: Screen): Camera
} = Function.dual(2, (model: Model, screen: Screen): Camera =>
  cameraFor(levelOf(model), cameraFocus(model), worldWindowOf(screen)),
)

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

const leanTarget = (maybeAim: Option.Option<Vector>): Vector =>
  Option.match(maybeAim, {
    onNone: () => ZERO_VECTOR,
    onSome: aim => scaleVector(aim, CAMERA_LEAN_PX),
  })

// NOTE: the camera leans toward where the player aims, eased so a flick of
// the stick does not jerk the view. It is a few dozen pixels at most, and it
// is stored in the Model because each frame's lean depends on the last.
export const leanCamera: {
  (maybeAim: Option.Option<Vector>, deltaMs: number): (lean: Vector) => Vector
  (lean: Vector, maybeAim: Option.Option<Vector>, deltaMs: number): Vector
} = Function.dual(
  3,
  (lean: Vector, maybeAim: Option.Option<Vector>, deltaMs: number): Vector => {
    const target = leanTarget(maybeAim)
    const share = clamp(deltaMs / CAMERA_LEAN_EASE_MS, 0, 1)
    const next = {
      x: lean.x + (target.x - lean.x) * share,
      y: lean.y + (target.y - lean.y) * share,
    }
    return Math.abs(next.x - target.x) < 0.05 &&
      Math.abs(next.y - target.y) < 0.05
      ? target
      : next
  },
)
