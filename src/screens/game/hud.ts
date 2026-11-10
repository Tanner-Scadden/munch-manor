import { Array, Function, Option, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from '../../art/font'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  group,
  spriteShapes,
} from '../../art/sprite'
import { gunIcon } from '../../art/sprites/guns'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  HEART_SPRITE,
} from '../../art/sprites/hearts'
import { TRAP_ICONS } from '../../art/sprites/traps'
import { ammoLevelOf, isOutOfGuns } from '../../features/hud/ammoWarning'
import { isWaitingOnYou } from '../../features/hud/readyNudge'
import { roomsCounterShapes } from '../../features/kitchen/roomsFound'
import {
  isCountdownBeckoning,
  isOpenBreak,
} from '../../features/onboarding/onboarding'
import { isCouchPlay } from '../../input/couch'
import { bossBarShapes } from '../../render/bossView'
import { type Camera, viewBoxOf, worldToView } from '../../render/camera'
import { FULL_TURN, centeredGlyphs, placeSprite } from '../../render/drawing'
import {
  HEART_SPACING,
  HUD_MARGIN,
  HUD_STRIP_HEIGHT,
  type HudLayout,
  MELEE_SLOT_INDEX,
  SLOT_GAP,
  SLOT_HEIGHT,
  STREAK_X,
  STREAK_Y,
  TRAP_SLOT_WIDTH,
  hudLayoutFor,
  slotLeftOf,
  slotWidthOf,
} from '../../render/hudLayout'
import { PERK_ICONS } from '../../render/kitchenGearView'
import { seatColorOf } from '../../render/partyView'
import { maybeMsSinceHurt } from '../../render/playerView'
import { boostChipShapes } from '../../render/powerupView'
import { maybeLeakSpan } from '../../render/room/kitchenLeak'
import type { Screen } from '../../render/screen'
import {
  HEART_FLASH_MS,
  HEART_PULSE_GROWTH,
  HEART_PULSE_MS,
  HEART_SHAKE_CYCLES,
  HEART_SHAKE_PX,
  MS_PER_SECOND,
  STREAK_FADED_OPACITY,
  STREAK_FADE_MS,
  STREAK_MIN_SHOWN,
  STREAK_PULSE_MS,
  STREAK_PULSE_SCALE,
  STREAK_SCALE,
  STREAK_WINDOW_MS,
} from '../../shared/constants'
import { TRAP_KIND_ORDER, maybeSelectedKind } from '../../world/gear/traps'
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
} from '../../world/gear/weapons'
import { maxHpOf } from '../../world/heroes/calling'
import {
  focusOf,
  focusSlotOf,
  leadSeatOf,
  playersOf,
} from '../../world/party/party'
import { isPending, isPracticeGateHeld } from '../../world/run/lessons'
import { scoreOf } from '../../world/run/stats'
import type {
  CarriedGun,
  Player,
  TrapKind,
  WeaponKind,
} from '../../world/schema/entitySchema'
import {
  type GunPerk,
  Phase,
  type SeatState,
  Streak,
  TrapNotice,
} from '../../world/schema/worldSchema'
import { clamp } from '../../world/step/geometry'
import { isRoundActive, zombiesRemaining } from '../../world/waves/waves'
import { maybeBossBar } from '../../world/zombies/boss'
import { waveLabel } from './overlay'
import {
  kitchenBubbleShapes,
  soupBubbleShapes,
  stallBubbleShapes,
} from './stallBubble'

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
const WAITING_ON_YOU = bakeText('WAITING ON YOU', 'Alert')

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
    return isWaitingOnYou(model)
      ? [
          placeBaked(WAITING_ON_YOU, {
            x: layout.centerX,
            y: layout.subtitleY,
            align: 'Center',
          }),
        ]
      : isPending(model.lessons.openBreak)
        ? [
            placeBaked(NO_TIMER, {
              x: layout.centerX,
              y: layout.subtitleY,
              align: 'Center',
            }),
          ]
        : []
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
    Arriving: () => [],
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
  const { shown, balance } = focusOf(model).wallet
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
  maybePerk?: Option.Option<GunPerk>
}>

// NOTE: a cooked gun's perk (src/world/kitchen/stove.ts) sits on its slot's top left
// corner like a sticker, half over the border, clear of the icon and the
// count.
const PERK_STICKER_OUT_PX = 3

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
    maybePerk = Option.none(),
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
    ...Option.match(maybePerk, {
      onNone: () => [],
      onSome: perk => [
        placeSprite(
          x - PERK_STICKER_OUT_PX,
          top - PERK_STICKER_OUT_PX,
          PERK_ICONS[perk],
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
  maybePerk: Option.fromNullishOr(gun.perk),
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
  const { player } = focusOf(model)
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
  const maybeSelected = maybeSelectedKind(model, focusSlotOf(model))
  return pipe(
    TRAP_KIND_ORDER,
    Array.filter(kind => focusOf(model).trapStock[kind] > 0),
    Array.flatMap((kind, index) =>
      trapSlotShapes(
        layout.trapTop,
        kind,
        focusOf(model).trapStock[kind],
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
      const player = worldToView(camera, focusOf(model).player)
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
  mate: SeatState,
  row: number,
): ReadonlyArray<Canvas.Shape> => {
  const y = MATE_ROW_TOP + row * MATE_ROW_HEIGHT
  return [
    Canvas.Rect({
      x: HUD_MARGIN,
      y: y + 2,
      width: 3,
      height: 3,
      fill: seatColorOf(mate.seat.slot),
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
          ({ seat }) => seat.slot !== leadSeatOf(model).slot,
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
  ...heartShapes(focusOf(model).player),
  ...moneyShapes(model),
  ...mateHudShapes(model),
  ...streakShapes(model.streak),
  ...loadoutShapes(model, layout),
  ...boostChipShapes(
    focusOf(model).boosts,
    layout.boostLeft,
    layout.boostTop,
    layout.boostColumns,
  ),
  ...trapStockShapes(model, layout),
  ...trapNoticeShapes(model, camera),
  ...stallBubbleShapes(model, camera),
  ...kitchenBubbleShapes(model, camera),
  ...soupBubbleShapes(model, camera),
  ...roundHudShapes(model, layout),
  ...roomsCounterShapes(model, layout.scoreRight, layout.roomsTop),
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

const HUD_STRIP_COLOR = 'rgba(20, 15, 24, 0.75)'

// NOTE: in landscape the top HUD sits over the north wall, whose pictures,
// candles, and shelves made the hearts and the wave hard to read. A slim
// dark strip behind the HUD rows backs them. Portrait has its own band
// above the world, so it needs none.
export const hudStripShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    screen: Screen,
    camera: Camera,
  ): ReadonlyArray<Canvas.Shape> => {
    if (screen.layout !== 'Landscape' || !isHudShown(model.phase)) {
      return []
    }
    const stripPiece = (left: number, right: number): Canvas.Shape =>
      Canvas.Rect({
        x: left,
        y: 0,
        width: right - left,
        height: HUD_STRIP_HEIGHT,
        fill: HUD_STRIP_COLOR,
      })
    return Option.match(maybeLeakSpan(model), {
      onNone: () => [stripPiece(0, screen.width)],
      onSome: ({ left, right }) => {
        const gapLeft = Math.max(0, worldToView(camera, { x: left, y: 0 }).x)
        const gapRight = Math.min(
          screen.width,
          worldToView(camera, { x: right, y: 0 }).x,
        )
        return [stripPiece(0, gapLeft), stripPiece(gapRight, screen.width)]
      },
    })
  },
)

export const hudShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    screen: Screen,
    camera: Camera,
  ): ReadonlyArray<Canvas.Shape> =>
    isHudShown(model.phase)
      ? playHudShapes(model, hudLayoutFor(screen), camera)
      : [],
)
