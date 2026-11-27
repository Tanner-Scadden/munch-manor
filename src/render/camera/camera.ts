import { Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import { group } from '#art/sprite.ts'
import { couchFocus } from '#input/couch.ts'
import type * as Draw from '#render/draw.ts'
import { HUD_STRIP_HEIGHT, hudLayoutFor } from '#render/hud/hudLayout.ts'
import {
  CAMERA_LEAN_PX,
  CAMERA_LEAN_RATE,
  CAMERA_LEAN_RETURN_RATE,
  MS_PER_SECOND,
} from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import { Finale } from '#world/dare/dareSchema.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import {
  ZERO_VECTOR,
  clamp,
  clampLength,
  scaleVector,
} from '#world/step/geometry.ts'

import { glideFocus } from './cine.ts'
import { floorRowsSeen, lensOf } from './lens.ts'
import { type Box, LANDSCAPE_SIZE, type Screen, screenOf } from './screen.ts'

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

const followRows = (focus: number, level: Level, rows: number): number => {
  const { above, below } = floorRowsSeen(rows)
  const { top, bottom } = level.bounds
  const middle =
    bottom - top <= above + below
      ? (top + above + bottom - below) / 2
      : clamp(focus, top + above, bottom - below)
  return Math.round(middle - rows / 2)
}

export const cameraFor: {
  (focus: Vector, window?: WindowSize): (level: Level) => Camera
  (level: Level, focus: Vector, window?: WindowSize): Camera
} = Function.dual(
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
    y: followRows(focus.y, level, window.height),
    width: window.width,
    height: window.height,
    scale: 1,
    left: 0,
    top: 0,
  }),
)

export const cameraFocus = (model: Model): Vector =>
  Option.getOrElse(couchFocus(model), () => ({
    x: focusOf(model).player.x + model.cameraLean.x,
    y: focusOf(model).player.y + model.cameraLean.y,
  }))

export const worldWindowOf = (screen: Screen): WindowSize => ({
  width: Math.round(screen.world.width / screen.zoom),
  height: Math.round(screen.world.height / screen.zoom),
})

const KEY_CAP_RISE_PX = 3

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

const isFinaleOn = (model: Model): boolean =>
  !Finale.isAnyOf(['Hunting'])(model.dare.finale)

const stripReserveOf = (screen: Screen): number =>
  screen.layout === 'Landscape' ? Math.ceil(HUD_STRIP_HEIGHT / screen.zoom) : 0

const cameraLevelOf = (model: Model, screen: Screen): Level => {
  const level = levelOf(model)
  const above = stripReserveOf(screen)
  const below = isFinaleOn(model) ? clusterReserveOf(screen) : 0
  return above === 0 && below === 0
    ? level
    : {
        ...level,
        bounds: {
          ...level.bounds,
          top: level.bounds.top - above,
          bottom: level.bounds.bottom + below,
        },
      }
}

export const worldCameraFor: {
  (screen: Screen): (model: Model) => Camera
  (model: Model, screen: Screen): Camera
} = Function.dual(2, (model: Model, screen: Screen): Camera => {
  const window = worldWindowOf(screen)
  return cameraFor(
    cameraLevelOf(model, screen),
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

export const cameraOf = (model: Model): Camera =>
  worldCameraFor(model, screenOf(model))

export const screenCameraOf = (model: Model): Camera => {
  const screen = screenOf(model)
  return toScreenCamera(worldCameraFor(model, screen), screen)
}

export const worldToView: {
  (point: Vector): (camera: Camera) => Vector
  (camera: Camera, point: Vector): Vector
} = Function.dual(2, (camera: Camera, point: Vector): Vector =>
  lensOf(camera).projectInto(point.x, point.y, { x: 0, y: 0 }),
)

export const viewToWorld: {
  (point: Vector): (camera: Camera) => Vector
  (camera: Camera, point: Vector): Vector
} = Function.dual(2, (camera: Camera, point: Vector): Vector =>
  lensOf(camera).unprojectInto(point.x, point.y, { x: 0, y: 0 }),
)

export const viewBoxOf = (camera: Camera): Box => ({
  x: camera.left,
  y: camera.top,
  width: camera.width * camera.scale,
  height: camera.height * camera.scale,
})

export type ViewMargin = Readonly<{
  side: number
  above: number
  below: number
}>

const NO_MARGIN: ViewMargin = { side: 0, above: 0, below: 0 }

export const isInView: {
  (point: Vector, margin?: ViewMargin): (camera: Camera) => boolean
  (camera: Camera, point: Vector, margin?: ViewMargin): boolean
} = Function.dual(
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

export const placedAt: {
  (
    anchor: Vector,
    shapes: ReadonlyArray<Draw.Shape>,
  ): (camera: Camera) => Draw.Shape
  (
    camera: Camera,
    anchor: Vector,
    shapes: ReadonlyArray<Draw.Shape>,
  ): Draw.Shape
} = Function.dual(
  3,
  (
    camera: Camera,
    anchor: Vector,
    shapes: ReadonlyArray<Draw.Shape>,
  ): Draw.Shape => {
    const { translate, scale } = anchoredAt(camera, anchor)
    return group({
      translate,
      scale: scale === 1 ? undefined : { x: scale, y: scale },
      shapes,
    })
  },
)

export const anchoredToWorld: {
  (point: Vector): (anchored: Anchored) => Vector
  (anchored: Anchored, point: Vector): Vector
} = Function.dual(2, (anchored: Anchored, point: Vector): Vector => ({
  x: (point.x - anchored.translate.x) / anchored.scale,
  y: (point.y - anchored.translate.y) / anchored.scale,
}))

export const sceneOffset: {
  (shake: Vector): (camera: Camera) => Vector
  (camera: Camera, shake: Vector): Vector
} = Function.dual(2, (camera: Camera, shake: Vector): Vector => ({
  x: (shake.x - camera.x) * camera.scale + camera.left,
  y: (shake.y - camera.y) * camera.scale + camera.top,
}))

const LEAN_SETTLE_PX = 0.25

const easeShareOf: {
  (deltaMs: number): (ratePerSecond: number) => number
  (ratePerSecond: number, deltaMs: number): number
} = Function.dual(
  2,
  (ratePerSecond: number, deltaMs: number): number =>
    1 - DetMath.exp((-ratePerSecond * Math.max(0, deltaMs)) / MS_PER_SECOND),
)

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
    if (
      Math.abs(next.x - target.x) < LEAN_SETTLE_PX &&
      Math.abs(next.y - target.y) < LEAN_SETTLE_PX
    ) {
      return Object.is(lean.x, target.x) && Object.is(lean.y, target.y)
        ? lean
        : target
    }
    return next
  },
)
