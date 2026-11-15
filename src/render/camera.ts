import { Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../app/model'
import { group } from '../art/sprite'
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
import { lensOf } from './lens'
import { type Box, LANDSCAPE_SIZE, type Screen, screenOf } from './screen'

// CAMERA

// NOTE: x, y, width, and height are the window on the game's map the camera
// follows, in world pixels: the lens (src/render/lens.ts) looks at its
// middle and shows a game pixel there as one on the screen. scale, left, and
// top place the view on a canvas: a point the lens puts at p in the view
// lands at p * scale + left. The world canvas is the camera's own size, so
// there scale is 1 and left and top are 0. The overlay canvas holds the
// whole screen, where the world window sits below the HUD band and, in
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

// NOTE: where a point on the game's floor lands on the camera's canvas,
// through the lens (src/render/lens.ts). Everything drawn over the world
// in 2D places itself through this, so it sits on what it marks.
export const worldToView: {
  (point: Vector): (camera: Camera) => Vector
  (camera: Camera, point: Vector): Vector
} = Function.dual(2, (camera: Camera, point: Vector): Vector =>
  lensOf(camera).projectInto(point.x, point.y, { x: 0, y: 0 }),
)

// NOTE: the floor point under a point on the camera's canvas: the ray from
// the lens through it, cast onto the floor (a mouse's aim, a tap).
export const viewToWorld: {
  (point: Vector): (camera: Camera) => Vector
  (camera: Camera, point: Vector): Vector
} = Function.dual(2, (camera: Camera, point: Vector): Vector =>
  lensOf(camera).unprojectInto(point.x, point.y, { x: 0, y: 0 }),
)

// NOTE: where the camera's view sits on its canvas, in that canvas's pixels.
export const viewBoxOf = (camera: Camera): Box => ({
  x: camera.left,
  y: camera.top,
  width: camera.width * camera.scale,
  height: camera.height * camera.scale,
})

// NOTE: how far past each edge of the view, in the game's pixels, a floor
// point still counts as in it: what stands on a point rises up the screen
// from it, so a tall body's feet may be well under the bottom edge and
// still show, while one whose feet are over the top is out of sight.
export type ViewMargin = Readonly<{
  side: number
  above: number
  below: number
}>

const NO_MARGIN: ViewMargin = { side: 0, above: 0, below: 0 }

// NOTE: whether a floor point lands in the camera's view, or within the
// margin of it.
export const isInView: {
  (point: Vector, margin?: ViewMargin): (camera: Camera) => boolean
  (camera: Camera, point: Vector, margin?: ViewMargin): boolean
} = Function.dual(
  // NOTE: data-first starts with the camera, which has a scale.
  (args: IArguments): boolean =>
    typeof args[0] === 'object' && 'scale' in args[0],
  (camera: Camera, point: Vector, margin: ViewMargin = NO_MARGIN): boolean => {
    const lens = lensOf(camera)
    const x = lens.screenX(point.x, point.y)
    const y = lens.screenY(point.x, point.y)
    const side = margin.side * camera.scale
    return (
      x >= camera.left - side &&
      x <= camera.left + camera.width * camera.scale + side &&
      y >= camera.top - margin.above * camera.scale &&
      y <= camera.top + (camera.height + margin.below) * camera.scale
    )
  },
)

// NOTE: a group of shapes drawn in the game's pixels around one floor
// point, placed on the camera's canvas as a whole: the point lands where
// the lens puts it, and the group keeps the canvas's scale, so a price tag
// or a reveal stays crisp pixel art on what it marks.
export type Anchored = Readonly<{ translate: Vector; scale: number }>

export const anchoredAt: {
  (anchor: Vector): (camera: Camera) => Anchored
  (camera: Camera, anchor: Vector): Anchored
} = Function.dual(2, (camera: Camera, anchor: Vector): Anchored => {
  const at = worldToView(camera, anchor)
  return {
    translate: {
      x: Math.round(at.x - anchor.x * camera.scale),
      y: Math.round(at.y - anchor.y * camera.scale),
    },
    scale: camera.scale,
  }
})

// NOTE: shapes drawn in the game's pixels around a floor point, placed on
// the camera's canvas as one group (anchoredAt).
export const placedAt: {
  (
    anchor: Vector,
    shapes: ReadonlyArray<Canvas.Shape>,
  ): (camera: Camera) => Canvas.Shape
  (
    camera: Camera,
    anchor: Vector,
    shapes: ReadonlyArray<Canvas.Shape>,
  ): Canvas.Shape
} = Function.dual(
  3,
  (
    camera: Camera,
    anchor: Vector,
    shapes: ReadonlyArray<Canvas.Shape>,
  ): Canvas.Shape => {
    const { translate, scale } = anchoredAt(camera, anchor)
    return group({
      translate,
      scale: scale === 1 ? undefined : { x: scale, y: scale },
      shapes,
    })
  },
)

// NOTE: a point in an anchored group's own game pixels, from a point on the
// canvas: the inverse of the group's placing.
export const anchoredToWorld: {
  (point: Vector): (anchored: Anchored) => Vector
  (anchored: Anchored, point: Vector): Vector
} = Function.dual(2, (anchored: Anchored, point: Vector): Vector => ({
  x: (point.x - anchored.translate.x) / anchored.scale,
  y: (point.y - anchored.translate.y) / anchored.scale,
}))

// NOTE: the flat map's offset: the world's shapes as one flat list on the
// game's own map, moved by the shake, for the tests and the tools that read
// a frame's shapes as plain data (worldLayerShapes). The screen is drawn by
// the 3D renderer through the lens.
export const sceneOffset: {
  (shake: Vector): (camera: Camera) => Vector
  (camera: Camera, shake: Vector): Vector
} = Function.dual(2, (camera: Camera, shake: Vector): Vector => ({
  x: (shake.x - camera.x) * camera.scale + camera.left,
  y: (shake.y - camera.y) * camera.scale + camera.top,
}))

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
