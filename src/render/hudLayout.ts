import { Function } from 'effect'

import { PLAYER_MAX_HP } from '../shared/constants'
import { type Box, type Screen, thumbAreaTop } from './screen'

// Where the HUD's parts sit on each screen: the hearts, the streak, the gun
// and trap slots, and the strip behind the top rows. The HUD draws there
// (src/screens/game/hud.ts), the touch controls lay their buttons over the
// slots, and a fridge prize flies to its gun slot.

export const HEART_SPACING = 9
export const HUD_MARGIN = 5

export const STREAK_X = HUD_MARGIN + 8
export const STREAK_Y = HUD_MARGIN + 30

export const SLOT_HEIGHT = 12
export const SLOT_GAP = 3
export const TRAP_SLOT_WIDTH = 24

// NOTE: the row's slots by layout. In landscape they are one line: a gun's
// icon, pips, and ammo side by side. In portrait a phone held upright has
// room for the four in one row (two guns, the melee slot, the reload
// button) only if the slots stack: a gun's icon and pips over its ammo, and
// the melee slot and the reload button square, the row's height. Every
// target stays at least 48 px wide on a 360 px phone (24 HUD pixels).
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

// NOTE: the reload button's face past the melee slot (src/screens/game/touchControls.ts):
// one more slot in landscape, a square the row's height in portrait.
export const reloadFaceOf = (
  screen: Screen,
): Readonly<{ width: number; height: number }> =>
  screen.layout === 'Landscape'
    ? { width: 18, height: SLOT_HEIGHT }
    : { width: SLOT_SIZES.Portrait.height, height: SLOT_SIZES.Portrait.height }

const BOOST_CHIPS_LEFT = HUD_MARGIN + PLAYER_MAX_HP * HEART_SPACING + 2
const BOOST_CHIP_STRIDE = 16
const BOOST_CHIPS = 4

const PAUSE_BUTTON_CLEARANCE = 34
const PORTRAIT_PAUSE_CLEARANCE = 24

export type HudLayout = Readonly<{
  centerX: number
  titleY: number
  subtitleY: number
  scoreRight: number
  roomsTop: number
  boostLeft: number
  boostTop: number
  boostColumns: number
  slots: SlotSizes
  slotLeft: number
  slotTop: number
  trapTop: number
}>

// NOTE: the two guns sit centered at the bottom, with the melee slot on
// their right (and on touch the reload button past it, src/screens/game/touchControls.ts).
// In portrait they sit at the bottom of the thumb area, stacked (SLOT_SIZES),
// and the HUD is a band on top.
export const hudLayoutFor = (screen: Screen): HudLayout => {
  const slots = SLOT_SIZES[screen.layout]
  const slotTop = screen.height - HUD_MARGIN - slots.height
  const slotLeft = Math.round((screen.width - gunPairWidth(slots)) / 2)
  if (screen.layout === 'Landscape') {
    return {
      centerX: screen.width / 2,
      titleY: HUD_MARGIN - 2,
      subtitleY: 11,
      scoreRight: screen.width - HUD_MARGIN - PAUSE_BUTTON_CLEARANCE,
      roomsTop: HUD_MARGIN + 9,
      boostLeft: BOOST_CHIPS_LEFT,
      boostTop: HUD_MARGIN - 3,
      boostColumns: 2,
      slots,
      slotLeft,
      slotTop,
      trapTop: slotTop,
    }
  } else {
    const scoreRight = screen.width - HUD_MARGIN - PORTRAIT_PAUSE_CLEARANCE
    return {
      centerX: screen.width / 2,
      titleY: screen.world.y - 17,
      subtitleY: screen.world.y - 9,
      scoreRight,
      roomsTop: HUD_MARGIN + 9,
      boostLeft: scoreRight - BOOST_CHIPS * BOOST_CHIP_STRIDE + 3,
      boostTop: HUD_MARGIN + 7,
      boostColumns: BOOST_CHIPS,
      slots,
      slotLeft,
      slotTop,
      trapTop: Math.max(
        thumbAreaTop(screen) + HUD_MARGIN,
        slotTop - SLOT_HEIGHT - SLOT_GAP * 2,
      ),
    }
  }
}

// NOTE: slots 0 and 1 are the guns, slot 2 the melee slot, narrower: it
// has only its icon and ∞, or the Pan's icon and dent meter.
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
