import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { VIEW_HEIGHT, VIEW_WIDTH } from './constants'
import { clamp } from './geometry'
import type { Model, SurfaceRectangle, Vector } from './model'
import { group } from './sprite'

// LAYOUT

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

// NOTE: a phone on its side draws the world 4/3 bigger than a desktop, so a
// zombie reads at a glance while a thumb steers (owner, 2026-10-30). The
// window shows 240 by 135 of the room, whole pixels, stretched over the same
// 320 by 180 screen, so the HUD on it keeps its size. A keyboard and mouse
// keep the whole 320 by 180 in any window.
const LANDSCAPE_TOUCH_ZOOM = 4 / 3

export const LANDSCAPE_TOUCH_SCREEN: Screen = {
  ...LANDSCAPE_SCREEN,
  zoom: LANDSCAPE_TOUCH_ZOOM,
}

// NOTE: a portrait screen is as many arena pixels wide as a landscape phone
// is tall, so the HUD, the banners, and the cards keep the scale they have
// when the phone is turned. Its height follows the phone's shape, the HUD
// band sits on top, the world window under it, and the rest below is the
// thumb area.
export const PORTRAIT_WIDTH = 180
export const PORTRAIT_HUD_PX = 44
const PORTRAIT_MIN_THUMB_PX = 76
const PORTRAIT_MAX_WORLD_SHARE = 0.63
const PORTRAIT_MIN_HEIGHT =
  PORTRAIT_HUD_PX + VIEW_HEIGHT + PORTRAIT_MIN_THUMB_PX
const PORTRAIT_MAX_HEIGHT = 440
const PORTRAIT_DEFAULT_HEIGHT = 390

// NOTE: the world window shows the room 128 rows high, across
// 180 * 128 / height of its width, so a taller window zooms in further.
// Changed on 2026-10-30 at the owner's request, from the room's full 180
// rows: a phone held upright draws a Groaner about 1.4 times as big as it
// did. These are the window heights, shortest first. Each one shows a whole
// number of the room's columns (96 to 128), so the window, the camera, and
// the zoom stay exact.
export const PORTRAIT_VIEW_ROWS = 128

const PORTRAIT_WINDOW_HEIGHTS: Array.NonEmptyReadonlyArray<number> = [
  VIEW_HEIGHT,
  192,
  240,
  256,
]

const fitsThumbs = (screenHeight: number, windowHeight: number): boolean =>
  screenHeight - PORTRAIT_HUD_PX - windowHeight >= PORTRAIT_MIN_THUMB_PX &&
  windowHeight <= screenHeight * PORTRAIT_MAX_WORLD_SHARE

// NOTE: the tallest window that still leaves a thumb area at least 76
// pixels tall and keeps the world window under two thirds of the screen. A
// 390 or 400 pixel screen (390x844, 430x932, 360x800) gets a 240 pixel
// window, which shows 96 by 128 of the room at 15/8, and a 320 pixel one
// (375x667) a 192 pixel window, 120 by 128 at 3/2.
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
    zoom: windowHeight / PORTRAIT_VIEW_ROWS,
  }
}

export const DEFAULT_PORTRAIT_SCREEN = portraitScreen(PORTRAIT_DEFAULT_HEIGHT)

const layoutOf = (model: Model): Layout =>
  model.lastDevice === 'Touch' && model.orientation === 'Portrait'
    ? 'Portrait'
    : 'Landscape'

export const isPortrait = (model: Model): boolean =>
  layoutOf(model) === 'Portrait'

export const screenOf = (model: Model): Screen => {
  if (isPortrait(model)) {
    return portraitScreen(
      Option.match(model.maybeSurface, {
        onNone: () => PORTRAIT_DEFAULT_HEIGHT,
        onSome: portraitHeightFor,
      }),
    )
  } else if (model.lastDevice === 'Touch') {
    return LANDSCAPE_TOUCH_SCREEN
  } else {
    return LANDSCAPE_SCREEN
  }
}

export const thumbAreaTop = (screen: Screen): number =>
  screen.world.y + screen.world.height

// NOTE: banners, cards, and the end screens are laid out on the landscape
// screen. In portrait they are drawn centered on the world window instead,
// which keeps anything narrower than the window whole.
export const landscapeFrameOffset = (screen: Screen): Vector => ({
  x: screen.world.x + Math.round((screen.world.width - VIEW_WIDTH) / 2),
  y: screen.world.y + Math.round((screen.world.height - VIEW_HEIGHT) / 2),
})

export const inLandscapeFrame = (
  screen: Screen,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  screen.layout === 'Landscape' || Array.isReadonlyArrayEmpty(shapes)
    ? shapes
    : [group({ translate: landscapeFrameOffset(screen), shapes })]

// SCREEN TO VIEW

type ScreenSize = Readonly<{ width: number; height: number }>

const LANDSCAPE_SIZE: ScreenSize = { width: VIEW_WIDTH, height: VIEW_HEIGHT }

const viewScale = (
  surface: SurfaceRectangle,
  screen: ScreenSize = LANDSCAPE_SIZE,
): number =>
  Math.min(surface.width / screen.width, surface.height / screen.height)

export const clientToView = (
  surface: SurfaceRectangle,
  client: Vector,
  screen: ScreenSize = LANDSCAPE_SIZE,
): Option.Option<Vector> => {
  const scale = viewScale(surface, screen)
  if (scale <= 0) {
    return Option.none()
  }

  const viewLeft = surface.left + (surface.width - screen.width * scale) / 2
  const viewTop = surface.top + (surface.height - screen.height * scale) / 2
  return Option.some({
    x: (client.x - viewLeft) / scale,
    y: (client.y - viewTop) / scale,
  })
}

export const isLeftHalf = (
  surface: SurfaceRectangle,
  clientX: number,
): boolean => clientX < surface.left + surface.width / 2
