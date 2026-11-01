import { Array, Option, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { ammoLevelOf, isOutOfGuns } from './ammoWarning'
import { maybeBossBar } from './boss'
import { bossBarShapes } from './bossView'
import { maxHpOf } from './calling'
import { type Camera, viewBoxOf, worldToView } from './camera'
import {
  HEART_FLASH_MS,
  HEART_PULSE_GROWTH,
  HEART_PULSE_MS,
  HEART_SHAKE_CYCLES,
  HEART_SHAKE_PX,
  MS_PER_SECOND,
  PLAYER_MAX_HP,
  STREAK_FADED_OPACITY,
  STREAK_FADE_MS,
  STREAK_MIN_SHOWN,
  STREAK_PULSE_MS,
  STREAK_PULSE_SCALE,
  STREAK_SCALE,
  STREAK_WINDOW_MS,
} from './constants'
import { isCouchPlay } from './couch'
import { FULL_TURN, centeredGlyphs, placeSprite } from './drawing'
import {
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from './font'
import { clamp } from './geometry'
import { isPending } from './lessons'
import { isPracticeGateHeld } from './lessons'
import {
  type CarriedGun,
  type Model,
  Phase,
  type Player,
  Streak,
  type TrapKind,
  TrapNotice,
  type WeaponKind,
} from './model'
import { isCountdownBeckoning, isOpenBreak } from './onboarding'
import { type SeatedPlayer, leadSeatOf, playersOf } from './party'
import { seatColorOf } from './partyView'
import { maybeMsSinceHurt } from './playerView'
import { boostChipShapes } from './powerupView'
import { type Box, type Screen, thumbAreaTop } from './screen'
import { waveLabel } from './screens'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  group,
  spriteShapes,
} from './sprite'
import { gunIcon } from './sprites/guns'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  HEART_SPRITE,
} from './sprites/hearts'
import { TRAP_ICONS } from './sprites/traps'
import { kitchenBubbleShapes, stallBubbleShapes } from './stallBubble'
import { scoreOf } from './stats'
import { TRAP_KIND_ORDER, maybeSelectedKind } from './traps'
import { isRoundActive, zombiesRemaining } from './waves'
import {
  gunsOf,
  hasEndlessRounds,
  heldSlotOf,
  isReloadable,
  isReloading,
  isWieldingMelee,
  looseRounds,
  magazineOf,
  maxTier,
  maybePanOf,
} from './weapons'

// HUD

const HEART_SPACING = 9
const HUD_MARGIN = 5

const STREAK_X = HUD_MARGIN + 8
const STREAK_Y = HUD_MARGIN + 30

const SLOT_HEIGHT = 12
export const SLOT_GAP = 3
const TRAP_SLOT_WIDTH = 24

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

// NOTE: the reload button's face past the melee slot (src/touchControls.ts):
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

type HudLayout = Readonly<{
  centerX: number
  titleY: number
  subtitleY: number
  scoreRight: number
  boostLeft: number
  boostTop: number
  boostColumns: number
  slots: SlotSizes
  slotLeft: number
  slotTop: number
  trapTop: number
}>

// NOTE: the two guns sit centered at the bottom, with the melee slot on
// their right (and on touch the reload button past it, src/touchControls.ts).
// In portrait they sit at the bottom of the thumb area, stacked (SLOT_SIZES),
// and the HUD is a band on top.
const hudLayoutFor = (screen: Screen): HudLayout => {
  const slots = SLOT_SIZES[screen.layout]
  const slotTop = screen.height - HUD_MARGIN - slots.height
  const slotLeft = Math.round((screen.width - gunPairWidth(slots)) / 2)
  if (screen.layout === 'Landscape') {
    return {
      centerX: screen.width / 2,
      titleY: HUD_MARGIN - 2,
      subtitleY: 11,
      scoreRight: screen.width - HUD_MARGIN - PAUSE_BUTTON_CLEARANCE,
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

const streakShapes = (streak: Streak): ReadonlyArray<Canvas.Shape> =>
  Streak.match(streak, {
    Cold: () => [],
    Hot: ({ count, remainingMs }) => {
      if (count < STREAK_MIN_SHOWN) {
        return []
      }

      const scale =
        STREAK_WINDOW_MS - remainingMs < STREAK_PULSE_MS
          ? STREAK_PULSE_SCALE
          : STREAK_SCALE
      return [
        group({
          translate: { x: STREAK_X, y: STREAK_Y },
          scale: { x: scale, y: scale },
          opacity: remainingMs < STREAK_FADE_MS ? STREAK_FADED_OPACITY : 1,
          shapes: centeredGlyphs(`x${count}`, 'Streak'),
        }),
      ]
    },
  })

const heartShakeX = (maybeHeartPulseMs: Option.Option<number>): number =>
  Option.match(maybeHeartPulseMs, {
    onNone: () => 0,
    onSome: pulseMs => {
      const progress = pulseMs / HEART_PULSE_MS
      return Math.round(
        Math.sin(progress * FULL_TURN * HEART_SHAKE_CYCLES) *
          HEART_SHAKE_PX *
          (1 - progress),
      )
    },
  })

const lostHeartShape = (
  x: number,
  y: number,
  maybeHeartPulseMs: Option.Option<number>,
): Canvas.Shape =>
  Option.match(maybeHeartPulseMs, {
    onNone: () => placeSprite(x, y, EMPTY_HEART_SPRITE),
    onSome: pulseMs => {
      const growth =
        1 + HEART_PULSE_GROWTH * Math.sin((Math.PI * pulseMs) / HEART_PULSE_MS)
      return group({
        translate: { x: Math.round(x), y: Math.round(y) },
        scale: { x: growth, y: growth },
        shapes:
          pulseMs < HEART_FLASH_MS ? FLASH_HEART_SPRITE : EMPTY_HEART_SPRITE,
      })
    },
  })

const heartShape =
  (hp: number, maybeHeartPulseMs: Option.Option<number>) =>
  (index: number): Canvas.Shape => {
    const x =
      HUD_MARGIN + 3 + index * HEART_SPACING + heartShakeX(maybeHeartPulseMs)
    const y = HUD_MARGIN + 3
    if (index < hp) {
      return placeSprite(x, y, HEART_SPRITE)
    } else if (index === hp) {
      return lostHeartShape(x, y, maybeHeartPulseMs)
    } else {
      return placeSprite(x, y, EMPTY_HEART_SPRITE)
    }
  }

const heartShapes = (player: Player): ReadonlyArray<Canvas.Shape> => {
  const maybeHeartPulseMs = Option.filter(
    maybeMsSinceHurt(player),
    msSinceHurt => msSinceHurt < HEART_PULSE_MS,
  )
  return Array.makeBy(maxHpOf(player), heartShape(player.hp, maybeHeartPulseMs))
}

export const secondsLeft = (remainingMs: number): number =>
  Math.ceil(remainingMs / MS_PER_SECOND)

const hudText = (
  layout: HudLayout,
  y: number,
  content: string,
  tone: TextTone,
): ReadonlyArray<Canvas.Shape> =>
  textShapes(content, tone, layout.centerX, y, 'Center')

// NOTE: the first timed break's countdown blinks red, so the clock is seen.
const COUNTDOWN_BLINK_MS = 400

const TRY_CONTROLS = bakeText('TRY THE CONTROLS', 'Prompt')
const NO_TIMER = bakeText('NO TIMER', 'Prompt')

const breakSubtitleShapes = (
  model: Model,
  layout: HudLayout,
  remainingMs: number,
): ReadonlyArray<Canvas.Shape> => {
  if (isPracticeGateHeld(model)) {
    return [
      placeBaked(TRY_CONTROLS, {
        x: layout.centerX,
        y: layout.subtitleY,
        align: 'Center',
      }),
    ]
  } else if (isOpenBreak(model)) {
    return [
      placeBaked(NO_TIMER, {
        x: layout.centerX,
        y: layout.subtitleY,
        align: 'Center',
      }),
    ]
  } else {
    return hudText(
      layout,
      layout.subtitleY,
      `STARTS IN ${secondsLeft(remainingMs)}`,
      isCountdownBeckoning(model) &&
        Math.floor(model.elapsedMs / COUNTDOWN_BLINK_MS) % 2 === 0
        ? 'Alert'
        : 'Prompt',
    )
  }
}

const roundHudShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, remainingMs }) => [
      ...hudText(layout, layout.titleY, waveLabel(model.mode, wave), 'Plain'),
      ...breakSubtitleShapes(model, layout, remainingMs),
    ],
    Wave: ({ wave, spawns }) =>
      Option.match(maybeBossBar(model), {
        onNone: () => [
          ...hudText(
            layout,
            layout.titleY,
            waveLabel(model.mode, wave),
            'Plain',
          ),
          ...hudText(
            layout,
            layout.subtitleY,
            `ZOMBIES ${zombiesRemaining(model, spawns)}`,
            'Hint',
          ),
        ],
        onSome: bar => [
          ...hudText(
            layout,
            layout.titleY,
            `${waveLabel(model.mode, wave)}  ZOMBIES ${zombiesRemaining(model, spawns)}`,
            'Plain',
          ),
          ...bossBarShapes(
            bar,
            layout.centerX,
            layout.subtitleY + 1,
            model.elapsedMs,
          ),
        ],
      }),
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

const MONEY_Y = HUD_MARGIN + 9

const moneyShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const { shown, balance } = model.wallet
  const isTicking = shown !== balance
  return textShapes(
    `$${shown}`,
    isTicking ? 'Damage' : 'Coin',
    HUD_MARGIN,
    isTicking ? MONEY_Y - 1 : MONEY_Y,
    'Left',
  )
}

const SLOT_DIM_OPACITY = 0.5
const SLOT_FILL = 'rgba(8, 10, 12, 0.6)'
const SLOT_BORDER = 'rgba(244, 241, 222, 0.25)'
const SLOT_HELD_BORDER = '#ffe066'
const SLOT_TEXT_TOP = 3
const ENDLESS_ROUNDS = '\u221e'

const PIP_WIDTH = 2
const PIP_GAP = 1
const PIP_LEFT = 3
const PIP_DROP = 3
const PIP_ON_COLOR = '#ffe066'

// NOTE: where a stacked (portrait) slot's parts sit, down from its top: the
// icon's middle, the pips under it, then the ammo or the dent meter.
const STACKED_ICON_Y = 6
const STACKED_PIP_Y = 10
const STACKED_TEXT_Y = 14
const STACKED_METER_Y = 16
const MELEE_ICON_SIZE = 9
const PIP_OFF_COLOR = 'rgba(244, 241, 222, 0.25)'

type SlotGun = Readonly<{ weapon: WeaponKind; tier: number }>

type AmmoLook = 'Loaded' | 'Low' | 'Last' | 'Reloading' | 'Empty'

// NOTE: `maybeMeter` is the Clang Pan's dent meter in the melee slot, from
// 1 (flat) to 0 (fully dented), drawn as a bar in place of a count. `isBeckoning` pulses
// the slot's border gold: the other gun, until the player has swapped once.
type SlotLook = Readonly<{
  maybeGun: Option.Option<SlotGun>
  ammo: string
  isHeld: boolean
  ammoLook: AmmoLook
  maybeMeter?: Option.Option<number>
  isBeckoning?: boolean
  maybeIcon?: Option.Option<Sprite>
  isPulsing?: boolean
}>

const METER_WIDTH = 8
const METER_COLOR = '#ffe066'
const METER_DENTED_COLOR = '#ff4a4f'
const METER_TRACK_COLOR = 'rgba(244, 241, 222, 0.25)'

const meterShapes = (
  left: number,
  y: number,
  share: number,
): ReadonlyArray<Canvas.Shape> => {
  const filled = Math.round(clamp(share, 0, 1) * METER_WIDTH)
  return [
    Canvas.Rect({
      x: left,
      y,
      width: METER_WIDTH,
      height: 3,
      fill: METER_TRACK_COLOR,
    }),
    Canvas.Rect({
      x: left,
      y,
      width: Math.max(1, filled),
      height: 3,
      fill: filled > 0 ? METER_COLOR : METER_DENTED_COLOR,
    }),
  ]
}

const AMMO_TONES: Readonly<Record<AmmoLook, TextTone>> = {
  Loaded: 'Plain',
  Low: 'Fresh',
  Last: 'Alert',
  Reloading: 'Prompt',
  Empty: 'Alert',
}

// NOTE: running low blinks the count, amber slowly and then red quickly, so
// limited ammo is hard to miss. The blink reads the game's clock, so a
// paused game holds still.
const LOW_BLINK_MS = 420
const LAST_BLINK_MS = 180
const SLOT_LAST_BORDER = '#ff4a4f'
const SLOT_BECKON_MS = 520

const isBlinkOff = (look: AmmoLook, elapsedMs: number): boolean => {
  if (look === 'Low') {
    return Math.floor(elapsedMs / LOW_BLINK_MS) % 3 === 2
  } else if (look === 'Last') {
    return Math.floor(elapsedMs / LAST_BLINK_MS) % 2 === 1
  } else {
    return false
  }
}

const ammoTone = (look: AmmoLook, elapsedMs: number): TextTone =>
  isBlinkOff(look, elapsedMs) ? 'Plain' : AMMO_TONES[look]

const KNIFE_PULSE_MS = 260

const slotBorder = (
  { isHeld, ammoLook: look, isBeckoning = false, isPulsing = false }: SlotLook,
  elapsedMs: number,
): string => {
  if (isPulsing) {
    return Math.floor(elapsedMs / KNIFE_PULSE_MS) % 2 === 0
      ? SLOT_LAST_BORDER
      : SLOT_HELD_BORDER
  } else if (look === 'Last' && !isBlinkOff(look, elapsedMs)) {
    return SLOT_LAST_BORDER
  } else if (isHeld) {
    return SLOT_HELD_BORDER
  } else if (isBeckoning && Math.floor(elapsedMs / SLOT_BECKON_MS) % 2 === 0) {
    return SLOT_HELD_BORDER
  } else {
    return SLOT_BORDER
  }
}

const tierPipShapes = (
  left: number,
  y: number,
  { weapon, tier }: SlotGun,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(maxTier(weapon), index =>
    Canvas.Rect({
      x: left + index * (PIP_WIDTH + PIP_GAP),
      y,
      width: PIP_WIDTH,
      height: 1,
      fill: index < tier ? PIP_ON_COLOR : PIP_OFF_COLOR,
    }),
  )

const pipsWidth = ({ weapon }: SlotGun): number =>
  Math.max(0, maxTier(weapon) * (PIP_WIDTH + PIP_GAP) - PIP_GAP)

// NOTE: slots 0 and 1 are the guns, slot 2 the melee slot, narrower: it
// has only its icon and ∞, or the Pan's icon and dent meter.
export const MELEE_SLOT_INDEX = 2

const slotLeftOf = (layout: HudLayout, index: number): number =>
  layout.slotLeft + index * (layout.slots.gunWidth + SLOT_GAP)

const slotWidthOf = (layout: HudLayout, index: number): number =>
  index === MELEE_SLOT_INDEX ? layout.slots.meleeWidth : layout.slots.gunWidth

export const gunSlotBox = (screen: Screen, index: number): Box => {
  const layout = hudLayoutFor(screen)
  return {
    x: slotLeftOf(layout, index),
    y: layout.slotTop,
    width: slotWidthOf(layout, index),
    height: layout.slots.height,
  }
}

export const gunClusterBox = (screen: Screen): Box => {
  const layout = hudLayoutFor(screen)
  return {
    x: layout.slotLeft,
    y: layout.slotTop,
    width: gunPairWidth(layout.slots) + SLOT_GAP + layout.slots.meleeWidth,
    height: layout.slots.height,
  }
}

// NOTE: what a slot shows, in one line (landscape) or stacked (portrait):
// the gun's or the melee weapon's icon with its tier pips, then the ammo, or
// the Pan's dent meter.
const slotContentShapes = (
  x: number,
  top: number,
  width: number,
  isStacked: boolean,
  look: SlotLook,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const {
    maybeGun,
    ammo,
    ammoLook,
    maybeMeter = Option.none(),
    maybeIcon = Option.none(),
  } = look
  const middle = x + width / 2
  return [
    ...Option.match(maybeGun, {
      onNone: () => [],
      onSome: slotGun =>
        isStacked
          ? [
              placeSprite(
                middle,
                top + STACKED_ICON_Y,
                gunIcon(slotGun.weapon, slotGun.tier),
              ),
              ...tierPipShapes(
                middle - pipsWidth(slotGun) / 2,
                top + STACKED_PIP_Y,
                slotGun,
              ),
            ]
          : [
              placeSprite(
                x + 8,
                top + 5,
                gunIcon(slotGun.weapon, slotGun.tier),
              ),
              ...tierPipShapes(
                x + PIP_LEFT,
                top + SLOT_HEIGHT - PIP_DROP,
                slotGun,
              ),
            ],
    }),
    ...Option.match(maybeIcon, {
      onNone: () => [],
      onSome: icon => [
        isStacked
          ? placeSprite(middle - MELEE_ICON_SIZE / 2, top + 3, icon)
          : placeSprite(x + 3, top + 1, icon),
      ],
    }),
    ...Option.match(maybeMeter, {
      onNone: () =>
        isStacked
          ? textShapes(
              ammo,
              ammoTone(ammoLook, elapsedMs),
              middle,
              top + STACKED_TEXT_Y,
              'Center',
            )
          : textShapes(
              ammo,
              ammoTone(ammoLook, elapsedMs),
              x + width - 3,
              top + SLOT_TEXT_TOP,
              'Right',
            ),
      onSome: share =>
        isStacked
          ? meterShapes(middle - METER_WIDTH / 2, top + STACKED_METER_Y, share)
          : meterShapes(
              x + width - 3 - METER_WIDTH,
              top + SLOT_TEXT_TOP + 1,
              share,
            ),
    }),
  ]
}

const slotShapes = (
  layout: HudLayout,
  index: number,
  look: SlotLook,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = slotLeftOf(layout, index)
  const width = slotWidthOf(layout, index)
  const { height, isStacked } = layout.slots
  const top = layout.slotTop
  const shapes = [
    Canvas.Rect({
      x,
      y: top,
      width,
      height,
      fill: slotBorder(look, elapsedMs),
    }),
    Canvas.Rect({
      x: x + 1,
      y: top + 1,
      width: width - 2,
      height: height - 2,
      fill: SLOT_FILL,
    }),
    ...slotContentShapes(x, top, width, isStacked, look, elapsedMs),
  ]
  return look.isHeld ? shapes : [group({ opacity: SLOT_DIM_OPACITY, shapes })]
}

const ammoLook = (
  player: Player,
  isHeld: boolean,
  gun: CarriedGun,
): AmmoLook => {
  const level = ammoLevelOf(gun, player.calling)
  if (isHeld && isReloading(player)) {
    return 'Reloading'
  } else if (gun.loaded <= 0) {
    return 'Empty'
  } else if (level === 'Last') {
    return 'Last'
  } else if (level === 'Low') {
    return 'Low'
  } else {
    return 'Loaded'
  }
}

const ammoText = (gun: CarriedGun): string => {
  if (hasEndlessRounds(gun.kind)) {
    return `${gun.loaded}/${ENDLESS_ROUNDS}`
  } else if (isReloadable(gun.kind)) {
    return `${gun.loaded}/${looseRounds(gun)}`
  } else {
    return `${gun.loaded}`
  }
}

const gunSlotLook = (
  player: Player,
  gun: CarriedGun,
  isHeld: boolean,
): SlotLook => ({
  maybeGun: Option.some({ weapon: gun.kind, tier: gun.tier }),
  ammo: ammoText(gun),
  isHeld,
  ammoLook: ammoLook(player, isHeld, gun),
})

const EMPTY_SLOT: SlotLook = {
  maybeGun: Option.none(),
  ammo: '--',
  isHeld: false,
  ammoLook: 'Loaded',
}

// THE MELEE SLOT

// NOTE: the melee slot, right of the guns: the knife's icon and ∞, or once
// the fridge has given one, the Clang Pan's icon, tier pips, and dent
// meter. Held when it is in hand. With every gun dry it pulses red, as the
// melee weapon comes out by itself.
const KNIFE_PALETTE: Palette = { X: '#e9e3cf', R: '#a8302a', o: '#140c10' }

const KNIFE_SPRITE = spriteShapes(
  [
    '.......XX',
    '......XXX',
    '.....XXX.',
    '....XXX..',
    '...XXX...',
    '.RXXX....',
    '..RR.....',
    '.RRR.....',
    'RR.R.....',
  ],
  KNIFE_PALETTE,
  TOP_LEFT,
)

export const meleeSlotLook = (player: Player): SlotLook => ({
  ...Option.match(maybePanOf(player), {
    onNone: () => ({
      maybeGun: Option.none(),
      maybeIcon: Option.some(KNIFE_SPRITE),
    }),
    onSome: pan => ({
      maybeGun: Option.some({ weapon: pan.kind, tier: pan.tier }),
      maybeMeter: Option.some(pan.loaded / magazineOf(pan.kind, pan.tier)),
    }),
  }),
  ammo: ENDLESS_ROUNDS,
  isHeld: isWieldingMelee(player),
  ammoLook: 'Loaded',
  isPulsing: isOutOfGuns(player),
})

// NOTE: until the player has swapped once, the gun they are not holding
// pulses, where the swap happens (its Q badge on a keyboard, a tap on
// touch), in place of a SWAP GUNS label in the room.
const isSwapBeckoning = (model: Model): boolean =>
  isRoundActive(model.phase) && isPending(model.lessons.swap)

const beckonWhen = (look: SlotLook, isBeckoning: boolean): SlotLook =>
  isBeckoning && !look.isHeld ? { ...look, isBeckoning } : look

const loadoutShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Canvas.Shape> => {
  const { player } = model
  const { arsenal } = player
  const held = isWieldingMelee(player)
    ? Option.none()
    : Option.some(heldSlotOf(arsenal))
  const isBeckoning = isSwapBeckoning(model)
  const [first, ...rest] = gunsOf(arsenal)
  const secondSlot: SlotLook = Option.match(Array.head(rest), {
    onNone: () => EMPTY_SLOT,
    onSome: second =>
      beckonWhen(
        gunSlotLook(player, second, Option.contains(held, 'Second')),
        isBeckoning,
      ),
  })
  const isFirstHeld = Option.contains(held, 'First')
  const firstSlot = Array.isReadonlyArrayNonEmpty(rest)
    ? beckonWhen(gunSlotLook(player, first, isFirstHeld), isBeckoning)
    : gunSlotLook(player, first, isFirstHeld)
  return [
    ...slotShapes(layout, 0, firstSlot, model.elapsedMs),
    ...slotShapes(layout, 1, secondSlot, model.elapsedMs),
    ...slotShapes(
      layout,
      MELEE_SLOT_INDEX,
      meleeSlotLook(player),
      model.elapsedMs,
    ),
  ]
}

const trapSlotShapes = (
  top: number,
  kind: TrapKind,
  count: number,
  index: number,
  isSelected: boolean,
): ReadonlyArray<Canvas.Shape> => {
  const x = HUD_MARGIN + index * (TRAP_SLOT_WIDTH + SLOT_GAP)
  return [
    Canvas.Rect({
      x,
      y: top,
      width: TRAP_SLOT_WIDTH,
      height: SLOT_HEIGHT,
      fill: isSelected ? SLOT_HELD_BORDER : SLOT_BORDER,
    }),
    Canvas.Rect({
      x: x + 1,
      y: top + 1,
      width: TRAP_SLOT_WIDTH - 2,
      height: SLOT_HEIGHT - 2,
      fill: SLOT_FILL,
    }),
    placeSprite(x + 6, top + 6, TRAP_ICONS[kind]),
    ...textShapes(
      `x${count}`,
      'Plain',
      x + TRAP_SLOT_WIDTH - 3,
      top + SLOT_TEXT_TOP,
      'Right',
    ),
  ]
}

const trapStockShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Canvas.Shape> => {
  const maybeSelected = maybeSelectedKind(model)
  return pipe(
    TRAP_KIND_ORDER,
    Array.filter(kind => model.trapStock[kind] > 0),
    Array.flatMap((kind, index) =>
      trapSlotShapes(
        layout.trapTop,
        kind,
        model.trapStock[kind],
        index,
        Option.contains(maybeSelected, kind),
      ),
    ),
  )
}

const NOTICE_LIFT_PX = 14
const NOTICE_MARGIN_PX = 4

const trapNoticeShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  TrapNotice.match(model.trapNotice, {
    Quiet: () => [],
    Refused: ({ reason }) => {
      const content = String.toUpperCase(reason)
      const halfWidth = Math.ceil(textWidth(content) / 2) + NOTICE_MARGIN_PX
      const player = worldToView(camera, model.player)
      const view = viewBoxOf(camera)
      const x = clamp(
        Math.round(player.x),
        view.x + halfWidth,
        view.x + view.width - halfWidth,
      )
      const y = Math.max(view.y + 4, Math.round(player.y) - NOTICE_LIFT_PX)
      return textShapes(content, 'Alert', x, y, 'Center')
    },
  })

// NOTE: players sharing the keyboard each get a row under the HUD: their
// seat's color, their hearts, and their money (MULTIPLAYER.md, Phase 1).
const MATE_ROW_TOP = 24
const MATE_ROW_HEIGHT = 10

const mateRowShapes = (
  mate: SeatedPlayer,
  row: number,
): ReadonlyArray<Canvas.Shape> => {
  const y = MATE_ROW_TOP + row * MATE_ROW_HEIGHT
  return [
    Canvas.Rect({
      x: HUD_MARGIN,
      y: y + 2,
      width: 3,
      height: 3,
      fill: seatColorOf(mate.slot),
    }),
    ...Array.makeBy(maxHpOf(mate.player), index =>
      placeSprite(
        HUD_MARGIN + 9 + index * HEART_SPACING,
        y + 3,
        index < mate.player.hp ? HEART_SPRITE : EMPTY_HEART_SPRITE,
      ),
    ),
    ...textShapes(
      `$${mate.wallet.balance}`,
      'Coin',
      HUD_MARGIN + 9 + maxHpOf(mate.player) * HEART_SPACING,
      y,
      'Left',
    ),
  ]
}

const mateHudShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  isCouchPlay(model)
    ? Array.flatMap(
        Array.filter(
          playersOf(model),
          ({ slot }) => slot !== leadSeatOf(model).slot,
        ),
        mateRowShapes,
      )
    : []

const isHudShown = (phase: Phase): boolean =>
  isRoundActive(phase) || Phase.isAnyOf(['Paused'])(phase)

const playHudShapes = (
  model: Model,
  layout: HudLayout,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> => [
  ...heartShapes(model.player),
  ...moneyShapes(model),
  ...mateHudShapes(model),
  ...streakShapes(model.streak),
  ...loadoutShapes(model, layout),
  ...boostChipShapes(
    model.boosts,
    layout.boostLeft,
    layout.boostTop,
    layout.boostColumns,
  ),
  ...trapStockShapes(model, layout),
  ...trapNoticeShapes(model, camera),
  ...stallBubbleShapes(model, camera),
  ...kitchenBubbleShapes(model, camera),
  ...roundHudShapes(model, layout),
  ...(isRoundActive(model.phase)
    ? textShapes(
        `SCORE ${scoreOf(model.stats)}`,
        'Plain',
        layout.scoreRight,
        HUD_MARGIN,
        'Right',
      )
    : []),
]

export const HUD_STRIP_HEIGHT = 20
const HUD_STRIP_COLOR = 'rgba(20, 15, 24, 0.75)'

// NOTE: in landscape the top HUD sits over the north wall, whose pictures,
// candles, and shelves made the hearts and the wave hard to read. A slim
// dark strip behind the HUD rows backs them. Portrait has its own band
// above the world, so it needs none.
export const hudStripShapes = (
  model: Model,
  screen: Screen,
): ReadonlyArray<Canvas.Shape> =>
  screen.layout === 'Landscape' && isHudShown(model.phase)
    ? [
        Canvas.Rect({
          x: 0,
          y: 0,
          width: screen.width,
          height: HUD_STRIP_HEIGHT,
          fill: HUD_STRIP_COLOR,
        }),
      ]
    : []

export const hudShapes = (
  model: Model,
  screen: Screen,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  isHudShown(model.phase)
    ? playHudShapes(model, hudLayoutFor(screen), camera)
    : []
