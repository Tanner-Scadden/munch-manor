import { Array, Function, Option } from 'effect'

import type { Model } from '../app/model'
import { group } from '../art/sprite'
import type { SurfaceRectangle } from '../input/inputSchema'
import { VIEW_HEIGHT, VIEW_WIDTH } from '../shared/constants'
import type { Vector } from '../world/schema/entitySchema'
import { clamp } from '../world/step/geometry'
import type * as Draw from './draw'

export type Layout = 'Landscape' | 'Portrait'

export type Box = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type Screen = Readonly<{
  layout: Layout
  width: number
  height: number
  world: Box
  zoom: number
}>

export const LANDSCAPE_SCREEN: Screen = {
  layout: 'Landscape',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  world: { x: 0, y: 0, width: VIEW_WIDTH, height: VIEW_HEIGHT },
  zoom: 1,
}

const LANDSCAPE_TOUCH_ZOOM = 4 / 3

export const LANDSCAPE_TOUCH_SCREEN: Screen = {
  ...LANDSCAPE_SCREEN,
  zoom: LANDSCAPE_TOUCH_ZOOM,
}

const WIDE_STEP_PX = 4
export const LANDSCAPE_MAX_WIDTH = 388

export const landscapeWidthFor = (surface: SurfaceRectangle): number =>
  surface.height > 0
    ? clamp(
        Math.floor(
          (surface.width * VIEW_HEIGHT) / surface.height / WIDE_STEP_PX,
        ) * WIDE_STEP_PX,
        VIEW_WIDTH,
        LANDSCAPE_MAX_WIDTH,
      )
    : VIEW_WIDTH

export const landscapeTouchScreen = (width: number): Screen => ({
  ...LANDSCAPE_TOUCH_SCREEN,
  width,
  world: { ...LANDSCAPE_TOUCH_SCREEN.world, width },
})

export const PORTRAIT_WIDTH = 180
export const PORTRAIT_HUD_PX = 44
const PORTRAIT_MIN_THUMB_PX = 76
const PORTRAIT_MAX_WORLD_SHARE = 0.63
const PORTRAIT_MIN_HEIGHT =
  PORTRAIT_HUD_PX + VIEW_HEIGHT + PORTRAIT_MIN_THUMB_PX
const PORTRAIT_MAX_HEIGHT = 440
const PORTRAIT_DEFAULT_HEIGHT = 390

export const PORTRAIT_VIEW_ROWS = 160

const PORTRAIT_WINDOW_HEIGHTS: Array.NonEmptyReadonlyArray<number> = [
  VIEW_HEIGHT,
  192,
  240,
]

const fitsThumbs = (screenHeight: number, windowHeight: number): boolean =>
  screenHeight - PORTRAIT_HUD_PX - windowHeight >= PORTRAIT_MIN_THUMB_PX &&
  windowHeight <= screenHeight * PORTRAIT_MAX_WORLD_SHARE

const portraitWindowFor = (screenHeight: number): number =>
  Array.reduce(
    PORTRAIT_WINDOW_HEIGHTS,
    Array.headNonEmpty(PORTRAIT_WINDOW_HEIGHTS),
    (best, height) => (fitsThumbs(screenHeight, height) ? height : best),
  )

export const portraitHeightFor = (surface: SurfaceRectangle): number =>
  surface.width > 0
    ? clamp(
        Math.round((surface.height * PORTRAIT_WIDTH) / surface.width),
        PORTRAIT_MIN_HEIGHT,
        PORTRAIT_MAX_HEIGHT,
      )
    : PORTRAIT_DEFAULT_HEIGHT

export const portraitScreen = (height: number): Screen => {
  const windowHeight = portraitWindowFor(height)
  return {
    layout: 'Portrait',
    width: PORTRAIT_WIDTH,
    height,
    world: {
      x: 0,
      y: PORTRAIT_HUD_PX,
      width: PORTRAIT_WIDTH,
      height: windowHeight,
    },
    zoom: Math.max(LANDSCAPE_TOUCH_ZOOM, windowHeight / PORTRAIT_VIEW_ROWS),
  }
}

export const DEFAULT_PORTRAIT_SCREEN = portraitScreen(PORTRAIT_DEFAULT_HEIGHT)

const layoutOf = (model: Model): Layout =>
  model.lastDevice === 'Touch' && model.orientation === 'Portrait'
    ? 'Portrait'
    : 'Landscape'

export const isPortrait = (model: Model): boolean =>
  layoutOf(model) === 'Portrait'

const screenBeforeSnapOf = (model: Model): Screen => {
  if (isPortrait(model)) {
    return portraitScreen(
      Option.match(model.maybeSurface, {
        onNone: () => PORTRAIT_DEFAULT_HEIGHT,
        onSome: portraitHeightFor,
      }),
    )
  } else if (model.lastDevice === 'Touch') {
    return Option.match(model.maybeSurface, {
      onNone: () => LANDSCAPE_TOUCH_SCREEN,
      onSome: surface => landscapeTouchScreen(landscapeWidthFor(surface)),
    })
  } else {
    return LANDSCAPE_SCREEN
  }
}

const SNAP_TOLERANCE = 1e-6

const onWholeGamePixels = (
  screen: Screen,
  surface: SurfaceRectangle,
): Screen => {
  const ratio = surface.pixelRatio ?? 0
  const perScreenPixel = stagePlacement(surface, screen).scale * ratio
  const whole = Math.round(perScreenPixel)
  if (whole < 1 || Math.abs(perScreenPixel - whole) > SNAP_TOLERANCE) {
    return screen
  }
  const perGamePixel = Math.max(1, Math.round(whole * screen.zoom))
  return { ...screen, zoom: perGamePixel / whole }
}

export const screenOf = (model: Model): Screen =>
  Option.match(model.maybeSurface, {
    onNone: () => screenBeforeSnapOf(model),
    onSome: surface => onWholeGamePixels(screenBeforeSnapOf(model), surface),
  })

export const thumbAreaTop = (screen: Screen): number =>
  screen.world.y + screen.world.height

export const landscapeFrameOffset = (screen: Screen): Vector => ({
  x: screen.world.x + Math.round((screen.world.width - VIEW_WIDTH) / 2),
  y: screen.world.y + Math.round((screen.world.height - VIEW_HEIGHT) / 2),
})

export type FrameSpan = Readonly<{ left: number; width: number }>

export const frameSpanOf = (screen: Screen): FrameSpan => {
  const left = Math.min(0, -landscapeFrameOffset(screen).x)
  return { left, width: Math.max(VIEW_WIDTH, screen.width) }
}

const isLandscapeFrame = (screen: Screen): boolean => {
  const offset = landscapeFrameOffset(screen)
  return offset.x === 0 && offset.y === 0
}

export const inLandscapeFrame: {
  (
    shapes: ReadonlyArray<Draw.Shape>,
  ): (screen: Screen) => ReadonlyArray<Draw.Shape>
  (screen: Screen, shapes: ReadonlyArray<Draw.Shape>): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (
    screen: Screen,
    shapes: ReadonlyArray<Draw.Shape>,
  ): ReadonlyArray<Draw.Shape> =>
    isLandscapeFrame(screen) || Array.isReadonlyArrayEmpty(shapes)
      ? shapes
      : [group({ translate: landscapeFrameOffset(screen), shapes })],
)

type ScreenSize = Readonly<{ width: number; height: number }>

export const LANDSCAPE_SIZE: ScreenSize = {
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
}

export type StagePlacement = Readonly<{
  scale: number
  left: number
  top: number
}>

const toDevicePixel = (value: number, ratio: number): number =>
  ratio > 0 ? Math.round(value * ratio) / ratio : value

export const stagePlacement: {
  (screen: ScreenSize): (surface: SurfaceRectangle) => StagePlacement
  (surface: SurfaceRectangle, screen: ScreenSize): StagePlacement
} = Function.dual(
  2,
  (surface: SurfaceRectangle, screen: ScreenSize): StagePlacement => {
    const fit = Math.min(
      surface.width / screen.width,
      surface.height / screen.height,
    )
    const ratio = surface.pixelRatio ?? 0
    const devicePixels = fit * ratio
    const whole = Math.floor(devicePixels + 1e-6)
    const isSnapped = whole >= 1
    const scale = isSnapped ? whole / ratio : fit
    const align = (value: number): number =>
      isSnapped ? toDevicePixel(value, ratio) : value
    return {
      scale,
      left: align((surface.width - screen.width * scale) / 2),
      top: align((surface.height - screen.height * scale) / 2),
    }
  },
)

export const clientToView: {
  (
    client: Vector,
    screen?: ScreenSize,
  ): (surface: SurfaceRectangle) => Option.Option<Vector>
  (
    surface: SurfaceRectangle,
    client: Vector,
    screen?: ScreenSize,
  ): Option.Option<Vector>
} = Function.dual(
  (args: IArguments): boolean =>
    typeof args[0] === 'object' && 'width' in args[0],
  (
    surface: SurfaceRectangle,
    client: Vector,
    screen: ScreenSize = LANDSCAPE_SIZE,
  ): Option.Option<Vector> => {
    const { scale, left, top } = stagePlacement(surface, screen)
    if (scale <= 0) {
      return Option.none()
    }

    return Option.some({
      x: (client.x - surface.left - left) / scale,
      y: (client.y - surface.top - top) / scale,
    })
  },
)

export const isLeftHalf: {
  (clientX: number): (surface: SurfaceRectangle) => boolean
  (surface: SurfaceRectangle, clientX: number): boolean
} = Function.dual(
  2,
  (surface: SurfaceRectangle, clientX: number): boolean =>
    clientX < surface.left + surface.width / 2,
)
