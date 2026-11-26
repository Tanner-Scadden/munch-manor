import { Function } from 'effect'

import type { SurfaceRectangle } from '#input/inputSchema.ts'
import { PLAYER_MAX_HP } from '#shared/constants.ts'

import {
  type Box,
  type Screen,
  stagePlacement,
  thumbAreaTop,
} from './screen.ts'

export const HEART_SPACING = 9
export const HUD_MARGIN = 5

export const STREAK_X = HUD_MARGIN + 8
export const STREAK_Y = HUD_MARGIN + 30

export const SLOT_HEIGHT = 12
export const SLOT_GAP = 3
export const TRAP_SLOT_WIDTH = 24

type SlotSizes = Readonly<{
  gunWidth: number
  meleeWidth: number
  height: number
  isStacked: boolean
}>

const SLOT_SIZES: Readonly<Record<Screen['layout'], SlotSizes>> = {
  Landscape: {
    gunWidth: 40,
    meleeWidth: 26,
    height: SLOT_HEIGHT,
    isStacked: false,
  },
  Portrait: { gunWidth: 28, meleeWidth: 24, height: 24, isStacked: true },
}

const gunPairWidth = ({ gunWidth }: SlotSizes): number =>
  2 * gunWidth + SLOT_GAP

export const gunPairWidthOf = (screen: Screen): number =>
  gunPairWidth(SLOT_SIZES[screen.layout])

export const reloadFaceOf = (
  screen: Screen,
): Readonly<{ width: number; height: number }> =>
  screen.layout === 'Landscape'
    ? { width: 18, height: SLOT_HEIGHT }
    : { width: SLOT_SIZES.Portrait.height, height: SLOT_SIZES.Portrait.height }

const KEYS_LEFT = HUD_MARGIN
const KEYS_TOP = HUD_MARGIN + 10
const BOOST_CHIPS_LEFT = HUD_MARGIN + PLAYER_MAX_HP * HEART_SPACING + 2
const BOOST_CHIP_STRIDE = 16
const BOOST_CHIPS = 4

const PAUSE_BUTTON_CLEARANCE = 34
const PORTRAIT_PAUSE_CLEARANCE = 24

export type HudLayout = Readonly<{
  centerX: number
  titleY: number
  subtitleY: number
  keysLeft: number
  keysTop: number
  boostLeft: number
  boostTop: number
  boostColumns: number
  slots: SlotSizes
  slotLeft: number
  slotTop: number
  trapTop: number
  pocket: PocketSpots
}>

type PocketSpots = Readonly<{
  shutRight: number
  shutTop: number
  openRight: number
  openTop: number
  isBesideBossBar: boolean
}>

export const POCKET_CHIP_HEIGHT = 15
const POCKET_PORTRAIT_LIFT = 2
const POCKET_PORTRAIT_DROP = 2

export const hudLayoutFor = (screen: Screen): HudLayout => {
  const slots = SLOT_SIZES[screen.layout]
  const slotTop = screen.height - HUD_MARGIN - slots.height
  const slotLeft = Math.round((screen.width - gunPairWidth(slots)) / 2)
  if (screen.layout === 'Landscape') {
    return {
      centerX: screen.width / 2,
      titleY: HUD_MARGIN - 2,
      subtitleY: 11,
      keysLeft: KEYS_LEFT,
      keysTop: KEYS_TOP,
      boostLeft: BOOST_CHIPS_LEFT,
      boostTop: HUD_MARGIN - 3,
      boostColumns: 2,
      slots,
      slotLeft,
      slotTop,
      trapTop: slotTop,
      pocket: {
        shutRight: screen.width - HUD_MARGIN - PAUSE_BUTTON_CLEARANCE,
        shutTop: HUD_MARGIN - 3,
        openRight: screen.width - HUD_MARGIN - PAUSE_BUTTON_CLEARANCE,
        openTop: HUD_MARGIN - 3,
        isBesideBossBar: false,
      },
    }
  } else {
    const pauseLeft = screen.width - HUD_MARGIN - PORTRAIT_PAUSE_CLEARANCE
    return {
      centerX: screen.width / 2,
      titleY: screen.world.y - 17,
      subtitleY: screen.world.y - 9,
      keysLeft: KEYS_LEFT,
      keysTop: KEYS_TOP,
      boostLeft: pauseLeft - BOOST_CHIPS * BOOST_CHIP_STRIDE + 3,
      boostTop: HUD_MARGIN + 7,
      boostColumns: BOOST_CHIPS,
      slots,
      slotLeft,
      slotTop,
      trapTop: Math.max(
        thumbAreaTop(screen) + HUD_MARGIN,
        slotTop - SLOT_HEIGHT - SLOT_GAP * 2,
      ),
      pocket: {
        shutRight: screen.width - HUD_MARGIN,
        shutTop: screen.world.y - POCKET_CHIP_HEIGHT - POCKET_PORTRAIT_LIFT,
        openRight: screen.width - HUD_MARGIN,
        openTop: screen.world.y + POCKET_PORTRAIT_DROP,
        isBesideBossBar: true,
      },
    }
  }
}

export const MELEE_SLOT_INDEX = 2

export const slotLeftOf: {
  (index: number): (layout: HudLayout) => number
  (layout: HudLayout, index: number): number
} = Function.dual(
  2,
  (layout: HudLayout, index: number): number =>
    layout.slotLeft + index * (layout.slots.gunWidth + SLOT_GAP),
)

export const slotWidthOf: {
  (index: number): (layout: HudLayout) => number
  (layout: HudLayout, index: number): number
} = Function.dual(2, (layout: HudLayout, index: number): number =>
  index === MELEE_SLOT_INDEX ? layout.slots.meleeWidth : layout.slots.gunWidth,
)

export const gunSlotBox: {
  (index: number): (screen: Screen) => Box
  (screen: Screen, index: number): Box
} = Function.dual(2, (screen: Screen, index: number): Box => {
  const layout = hudLayoutFor(screen)
  return {
    x: slotLeftOf(layout, index),
    y: layout.slotTop,
    width: slotWidthOf(layout, index),
    height: layout.slots.height,
  }
})

export const gunClusterBox = (screen: Screen): Box => {
  const layout = hudLayoutFor(screen)
  return {
    x: layout.slotLeft,
    y: layout.slotTop,
    width: gunPairWidth(layout.slots) + SLOT_GAP + layout.slots.meleeWidth,
    height: layout.slots.height,
  }
}

export const HUD_STRIP_HEIGHT = 20

const TOP_HUD_CLEARANCE = 22
const KEY_CAP_CLEARANCE = 4

export type ClearWindow = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

export const clearWindowOf: {
  (gap: number): (screen: Screen) => ClearWindow
  (screen: Screen, gap: number): ClearWindow
} = Function.dual(2, (screen: Screen, gap: number): ClearWindow => {
  const window = screen.world
  const top =
    screen.layout === 'Landscape'
      ? window.y + TOP_HUD_CLEARANCE
      : window.y + gap
  return {
    left: window.x + gap,
    top,
    right: window.x + window.width - gap,
    bottom:
      Math.min(
        window.y + window.height,
        hudLayoutFor(screen).slotTop - KEY_CAP_CLEARANCE,
      ) - gap,
  }
})

const START_WAVE_PILL_HALF_CSS = 84
const START_WAVE_PILL_RISE_CSS = 86

export const startWavePillBox: {
  (scale: number): (screen: Screen) => Box
  (screen: Screen, scale: number): Box
} = Function.dual(2, (screen: Screen, scale: number): Box => {
  const cluster = gunClusterBox(screen)
  const halfWidth = START_WAVE_PILL_HALF_CSS / scale
  const height = START_WAVE_PILL_RISE_CSS / scale
  return {
    x: cluster.x + gunPairWidth(SLOT_SIZES[screen.layout]) / 2 - halfWidth,
    y: cluster.y - height,
    width: halfWidth * 2,
    height,
  }
})

const CORNER_INSET_CSS = 6
const CORNER_BUTTON_CSS = 48

export const cornerButtonBox: {
  (surface: SurfaceRectangle): (screen: Screen) => Box
  (screen: Screen, surface: SurfaceRectangle): Box
} = Function.dual(2, (screen: Screen, surface: SurfaceRectangle): Box => {
  const { scale, left, top } = stagePlacement(surface, screen)
  const right = surface.width - CORNER_INSET_CSS
  return {
    x: (right - CORNER_BUTTON_CSS - left) / scale,
    y: (CORNER_INSET_CSS - top) / scale,
    width: CORNER_BUTTON_CSS / scale,
    height: CORNER_BUTTON_CSS / scale,
  }
})
