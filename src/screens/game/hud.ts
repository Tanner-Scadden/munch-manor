import { Array, Function, Option, String, pipe } from 'effect'

import type { Model } from '#app/model.ts'
import {
  type TextTone,
  bakeText,
  placeBaked,
  textShapes,
  textWidth,
} from '#art/font.ts'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  group,
  spriteShapes,
} from '#art/sprite.ts'
import { gunIcon } from '#art/sprites/guns.ts'
import {
  EMPTY_HEART_SPRITE,
  FLASH_HEART_SPRITE,
  HEART_SPRITE,
} from '#art/sprites/hearts.ts'
import { TRAP_ICONS } from '#art/sprites/traps.ts'
import {
  type DarePocket,
  dareCardPointShapes,
  dareCardShapes,
  pocketBoxOf,
  pocketHeaderOf,
} from '#features/dare/dareCard.ts'
import { isOnLastShots } from '#features/hud/ammoWarning.ts'
import { isWaitingOnYou } from '#features/hud/readyNudge.ts'
import { roomsCounterShapes } from '#features/kitchen/roomsFound.ts'
import { isQuestOnCard } from '#features/onboarding/firstBreakQuest.ts'
import {
  isCountdownBeckoning,
  isOpenBreak,
} from '#features/onboarding/onboarding.ts'
import { isCouchPlay } from '#input/couch.ts'
import { bossBarShapes } from '#render/bossView.ts'
import { type Camera, viewBoxOf, worldToView } from '#render/camera.ts'
import * as Draw from '#render/draw.ts'
import { FULL_TURN, centeredGlyphs, placeSprite } from '#render/drawing.ts'
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
} from '#render/hudLayout.ts'
import { PERK_ICONS } from '#render/kitchenGearView.ts'
import { seatColorOf } from '#render/partyView.ts'
import { maybeMsSinceHurt } from '#render/playerView.ts'
import { boostChipShapes } from '#render/powerupView.ts'
import { maybeLeakSpan } from '#render/room/kitchenLeak.ts'
import type { Screen } from '#render/screen.ts'
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
} from '#shared/constants.ts'
import { maybeLevelProgress } from '#world/gear/gunLevels.ts'
import { TRAP_KIND_ORDER, maybeSelectedKind } from '#world/gear/traps.ts'
import {
  gunsOf,
  heldSlotOf,
  isReloading,
  isWieldingMelee,
  magazineOf,
  maxTier,
  maybePanOf,
} from '#world/gear/weapons.ts'
import { maxHpOf } from '#world/heroes/calling.ts'
import {
  focusOf,
  focusSlotOf,
  leadSeatOf,
  playersOf,
} from '#world/party/party.ts'
import { isPending, isPracticeGateHeld } from '#world/run/lessons.ts'
import type {
  CarriedGun,
  Player,
  TrapKind,
  WeaponKind,
} from '#world/schema/entitySchema.ts'
import {
  GameEvent,
  type GunPerk,
  Phase,
  type SeatState,
  Streak,
  TrapNotice,
} from '#world/schema/worldSchema.ts'
import { clamp } from '#world/step/geometry.ts'
import { isRoundActive, zombiesRemaining } from '#world/waves/waves.ts'
import { maybeBossBar } from '#world/zombies/boss.ts'

import { waveLabel } from './overlay.ts'
import { KEY_RING_SCALE, keyRingLabelOf, pocketOf } from './pocket.ts'
import { rattlesBubbleShapes } from './stallBubble.ts'

const streakShapes = (streak: Streak): ReadonlyArray<Draw.Shape> =>
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
): Draw.Shape =>
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
  (index: number): Draw.Shape => {
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

const heartShapes = (player: Player): ReadonlyArray<Draw.Shape> => {
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
): ReadonlyArray<Draw.Shape> =>
  textShapes(content, tone, layout.centerX, y, 'Center')

const COUNTDOWN_BLINK_MS = 400

const TRY_CONTROLS = bakeText('TRY THE CONTROLS', 'Prompt')
const NO_TIMER = bakeText('NO TIMER', 'Prompt')
const WAITING_ON_YOU = bakeText('WAITING ON YOU', 'Alert')

const breakSubtitleShapes = (
  model: Model,
  layout: HudLayout,
  remainingMs: number,
): ReadonlyArray<Draw.Shape> => {
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
): ReadonlyArray<Draw.Shape> =>
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
            bossBarCenterOf(model, layout),
            layout.subtitleY + 1,
            model.elapsedMs,
          ),
        ],
      }),
    Paused: () => [],
    Escaped: () => [],
    LeftEarly: () => [],
    GameOver: () => [],
  })

const BOSS_BAR_CARD_GAP = 3

const bossBarCenterOf = (model: Model, layout: HudLayout): number =>
  layout.pocket.isBesideBossBar
    ? Math.min(
        layout.centerX,
        Math.round(
          (HUD_MARGIN +
            pocketBoxOf(model, layout, 'Shut').left -
            BOSS_BAR_CARD_GAP) /
            2,
        ),
      )
    : layout.centerX

const keyRingShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Draw.Shape> => {
  const isNew = Array.some(model.frameEvents, GameEvent.isAnyOf(['KeysFound']))
  return [
    group({
      translate: {
        x: layout.keysLeft,
        y: isNew ? layout.keysTop - 1 : layout.keysTop,
      },
      scale: { x: KEY_RING_SCALE, y: KEY_RING_SCALE },
      shapes: textShapes(
        keyRingLabelOf(model),
        isNew ? 'Damage' : 'Coin',
        0,
        0,
        'Left',
      ),
    }),
  ]
}

const pocketShapes = (
  model: Model,
  layout: HudLayout,
  pocket: DarePocket,
): ReadonlyArray<Draw.Shape> => {
  const header = pocketHeaderOf(model, layout)
  return [
    ...dareCardShapes(model, layout, pocket),
    ...(pocket === 'Open' ? roomsCounterShapes(model, header.x, header.y) : []),
    ...(isQuestOnCard(model) ? dareCardPointShapes(model, layout, pocket) : []),
  ]
}

const SLOT_DIM_OPACITY = 0.5
const SLOT_FILL = 'rgba(8, 10, 12, 0.6)'
const SLOT_BORDER = 'rgba(244, 241, 222, 0.25)'
const SLOT_HELD_BORDER = '#ffe066'
const SLOT_TEXT_TOP = 3
const KNIFE_ROUNDS = '\u221e'

const PIP_WIDTH = 2
const PIP_GAP = 1
const PIP_LEFT = 3
const PIP_DROP = 3
const PIP_ON_COLOR = '#ffe066'

const STACKED_ICON_Y = 6
const STACKED_PIP_Y = 10
const STACKED_TEXT_Y = 14
const STACKED_METER_Y = 16
const MELEE_ICON_SIZE = 9
const PIP_OFF_COLOR = 'rgba(244, 241, 222, 0.25)'

type SlotGun = Readonly<{ weapon: WeaponKind; tier: number }>

type AmmoLook = 'Loaded' | 'Last' | 'Reloading' | 'Empty'

type SlotLook = Readonly<{
  maybeGun: Option.Option<SlotGun>
  ammo: string
  isHeld: boolean
  ammoLook: AmmoLook
  maybeMeter?: Option.Option<number>
  isBeckoning?: boolean
  maybeIcon?: Option.Option<Sprite>
  maybePerk?: Option.Option<GunPerk>
  maybeLevelBar?: Option.Option<LevelBar>
  isLevelFlashing?: boolean
}>

type LevelBar = Readonly<{ share: number; isMaxed: boolean }>

export const maybeLevelBarOf = (gun: CarriedGun): Option.Option<LevelBar> =>
  maxTier(gun.kind) === 0
    ? Option.none()
    : Option.some(
        Option.match(maybeLevelProgress(gun), {
          onNone: () => ({ share: 1, isMaxed: true }),
          onSome: share => ({ share, isMaxed: false }),
        }),
      )

const LEVEL_BAR_HEIGHT = 2
const LEVEL_BAR_DROP = 1
const LEVEL_BAR_COLOR = '#ffe066'
const LEVEL_MAXED_COLOR = '#ff9a2a'
const LEVEL_FLASH_COLOR = '#fff6c8'
const LEVEL_TRACK_COLOR = 'rgba(8, 10, 12, 0.75)'

const levelBarShapes = (
  x: number,
  top: number,
  width: number,
  { share, isMaxed }: LevelBar,
  isFlashing: boolean,
): ReadonlyArray<Draw.Shape> => {
  const filled = Math.round(clamp(share, 0, 1) * width)
  const fill = isFlashing
    ? LEVEL_FLASH_COLOR
    : isMaxed
      ? LEVEL_MAXED_COLOR
      : LEVEL_BAR_COLOR
  return [
    Draw.Rect({
      x,
      y: top,
      width,
      height: LEVEL_BAR_HEIGHT,
      fill: LEVEL_TRACK_COLOR,
    }),
    ...(filled > 0
      ? [
          Draw.Rect({
            x,
            y: top,
            width: filled,
            height: LEVEL_BAR_HEIGHT,
            fill,
          }),
        ]
      : []),
  ]
}

const LEVEL_FLASH_MS = 900
const LEVEL_FLASH_BLINK_MS = 110

const isLevelFlashOn = (elapsedMs: number): boolean =>
  Math.floor(elapsedMs / LEVEL_FLASH_BLINK_MS) % 2 === 0

const PERK_STICKER_OUT_PX = 3

const METER_WIDTH = 8
const METER_COLOR = '#ffe066'
const METER_DENTED_COLOR = '#ff4a4f'
const METER_TRACK_COLOR = 'rgba(244, 241, 222, 0.25)'

const meterShapes = (
  left: number,
  y: number,
  share: number,
): ReadonlyArray<Draw.Shape> => {
  const filled = Math.round(clamp(share, 0, 1) * METER_WIDTH)
  return [
    Draw.Rect({
      x: left,
      y,
      width: METER_WIDTH,
      height: 3,
      fill: METER_TRACK_COLOR,
    }),
    Draw.Rect({
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
  Last: 'Alert',
  Reloading: 'Prompt',
  Empty: 'Alert',
}

const LAST_BLINK_MS = 180
const SLOT_LAST_BORDER = '#ff4a4f'
const SLOT_BECKON_MS = 520

const isBlinkOff = (look: AmmoLook, elapsedMs: number): boolean =>
  look === 'Last' && Math.floor(elapsedMs / LAST_BLINK_MS) % 2 === 1

const ammoTone = (look: AmmoLook, elapsedMs: number): TextTone =>
  isBlinkOff(look, elapsedMs) ? 'Plain' : AMMO_TONES[look]

const slotBorder = (
  {
    isHeld,
    ammoLook: look,
    isBeckoning = false,
    isLevelFlashing = false,
  }: SlotLook,
  elapsedMs: number,
): string => {
  if (isLevelFlashing) {
    return isLevelFlashOn(elapsedMs) ? LEVEL_FLASH_COLOR : SLOT_HELD_BORDER
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
): ReadonlyArray<Draw.Shape> =>
  Array.makeBy(maxTier(weapon), index =>
    Draw.Rect({
      x: left + index * (PIP_WIDTH + PIP_GAP),
      y,
      width: PIP_WIDTH,
      height: 1,
      fill: index < tier ? PIP_ON_COLOR : PIP_OFF_COLOR,
    }),
  )

const pipsWidth = ({ weapon }: SlotGun): number =>
  Math.max(0, maxTier(weapon) * (PIP_WIDTH + PIP_GAP) - PIP_GAP)

const slotContentShapes = (
  x: number,
  top: number,
  width: number,
  isStacked: boolean,
  look: SlotLook,
  elapsedMs: number,
): ReadonlyArray<Draw.Shape> => {
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
): ReadonlyArray<Draw.Shape> => {
  const x = slotLeftOf(layout, index)
  const width = slotWidthOf(layout, index)
  const { height, isStacked } = layout.slots
  const top = layout.slotTop
  const shapes = [
    Draw.Rect({
      x,
      y: top,
      width,
      height,
      fill: slotBorder(look, elapsedMs),
    }),
    Draw.Rect({
      x: x + 1,
      y: top + 1,
      width: width - 2,
      height: height - 2,
      fill: SLOT_FILL,
    }),
    ...slotContentShapes(x, top, width, isStacked, look, elapsedMs),
    ...Option.match(look.maybeLevelBar ?? Option.none(), {
      onNone: () => [],
      onSome: bar =>
        levelBarShapes(
          x,
          top + height + LEVEL_BAR_DROP,
          width,
          bar,
          (look.isLevelFlashing ?? false) && isLevelFlashOn(elapsedMs),
        ),
    }),
  ]
  return look.isHeld ? shapes : [group({ opacity: SLOT_DIM_OPACITY, shapes })]
}

const ammoLook = (
  player: Player,
  isHeld: boolean,
  gun: CarriedGun,
): AmmoLook => {
  if (isHeld && isReloading(player)) {
    return 'Reloading'
  } else if (gun.loaded <= 0) {
    return 'Empty'
  } else if (isOnLastShots(gun, player.calling)) {
    return 'Last'
  } else {
    return 'Loaded'
  }
}

const ammoText = (gun: CarriedGun): string => `${gun.loaded}`

export const isJustLeveled: {
  (gun: CarriedGun): (model: Model) => boolean
  (model: Model, gun: CarriedGun): boolean
} = Function.dual(2, (model: Model, gun: CarriedGun): boolean =>
  Array.some(
    model.cosmetics.levelCallouts,
    ({ weapon, tier, ageMs }) =>
      weapon === gun.kind && tier === gun.tier && ageMs < LEVEL_FLASH_MS,
  ),
)

const gunSlotLook = (
  model: Model,
  player: Player,
  gun: CarriedGun,
  isHeld: boolean,
): SlotLook => ({
  maybeGun: Option.some({ weapon: gun.kind, tier: gun.tier }),
  ammo: ammoText(gun),
  isHeld,
  ammoLook: ammoLook(player, isHeld, gun),
  maybePerk: Option.fromNullishOr(gun.perk),
  maybeLevelBar: maybeLevelBarOf(gun),
  isLevelFlashing: isJustLeveled(model, gun),
})

const EMPTY_SLOT: SlotLook = {
  maybeGun: Option.none(),
  ammo: '--',
  isHeld: false,
  ammoLook: 'Loaded',
}

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

export const meleeSlotLook: {
  (player: Player): (model: Model) => SlotLook
  (model: Model, player: Player): SlotLook
} = Function.dual(2, (model: Model, player: Player): SlotLook => ({
  ...Option.match(maybePanOf(player), {
    onNone: () => ({
      maybeGun: Option.none(),
      maybeIcon: Option.some(KNIFE_SPRITE),
    }),
    onSome: pan => ({
      maybeGun: Option.some({ weapon: pan.kind, tier: pan.tier }),
      maybeMeter: Option.some(pan.loaded / magazineOf(pan.kind, pan.tier)),
      maybeLevelBar: maybeLevelBarOf(pan),
      isLevelFlashing: isJustLeveled(model, pan),
    }),
  }),
  ammo: KNIFE_ROUNDS,
  isHeld: isWieldingMelee(player),
  ammoLook: 'Loaded',
}))

const isSwapBeckoning = (model: Model): boolean =>
  isRoundActive(model.phase) && isPending(model.lessons.swap)

const beckonWhen = (look: SlotLook, isBeckoning: boolean): SlotLook =>
  isBeckoning && !look.isHeld ? { ...look, isBeckoning } : look

const loadoutShapes = (
  model: Model,
  layout: HudLayout,
): ReadonlyArray<Draw.Shape> => {
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
        gunSlotLook(model, player, second, Option.contains(held, 'Second')),
        isBeckoning,
      ),
  })
  const isFirstHeld = Option.contains(held, 'First')
  const firstSlot = Array.isReadonlyArrayNonEmpty(rest)
    ? beckonWhen(gunSlotLook(model, player, first, isFirstHeld), isBeckoning)
    : gunSlotLook(model, player, first, isFirstHeld)
  return [
    ...slotShapes(layout, 0, firstSlot, model.elapsedMs),
    ...slotShapes(layout, 1, secondSlot, model.elapsedMs),
    ...slotShapes(
      layout,
      MELEE_SLOT_INDEX,
      meleeSlotLook(model, player),
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
): ReadonlyArray<Draw.Shape> => {
  const x = HUD_MARGIN + index * (TRAP_SLOT_WIDTH + SLOT_GAP)
  return [
    Draw.Rect({
      x,
      y: top,
      width: TRAP_SLOT_WIDTH,
      height: SLOT_HEIGHT,
      fill: isSelected ? SLOT_HELD_BORDER : SLOT_BORDER,
    }),
    Draw.Rect({
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
): ReadonlyArray<Draw.Shape> => {
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
): ReadonlyArray<Draw.Shape> =>
  TrapNotice.match(model.cosmetics.trapNotice, {
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

const MATE_ROW_TOP = 24
const MATE_ROW_HEIGHT = 10

const mateRowShapes = (
  mate: SeatState,
  row: number,
): ReadonlyArray<Draw.Shape> => {
  const y = MATE_ROW_TOP + row * MATE_ROW_HEIGHT
  return [
    Draw.Rect({
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
  ]
}

const mateHudShapes = (model: Model): ReadonlyArray<Draw.Shape> =>
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
): ReadonlyArray<Draw.Shape> => [
  ...heartShapes(focusOf(model).player),
  ...keyRingShapes(model, layout),
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
  ...rattlesBubbleShapes(model, camera),
  ...roundHudShapes(model, layout),
  ...pocketShapes(model, layout, pocketOf(model)),
]

const HUD_STRIP_COLOR = 'rgba(20, 15, 24, 0.75)'

export const hudStripShapes: {
  (screen: Screen, camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape> => {
    if (screen.layout !== 'Landscape' || !isHudShown(model.phase)) {
      return []
    }
    const stripPiece = (left: number, right: number): Draw.Shape =>
      Draw.Rect({
        x: left,
        y: 0,
        width: right - left,
        height: HUD_STRIP_HEIGHT,
        fill: HUD_STRIP_COLOR,
      })
    return Option.match(maybeLeakSpan(model), {
      onNone: () => [stripPiece(0, screen.width)],
      onSome: ({ left, right, y }) => {
        const gapLeft = Math.max(0, worldToView(camera, { x: left, y }).x)
        const gapRight = Math.min(
          screen.width,
          worldToView(camera, { x: right, y }).x,
        )
        return [stripPiece(0, gapLeft), stripPiece(gapRight, screen.width)]
      },
    })
  },
)

export const hudShapes: {
  (screen: Screen, camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape> =>
    isHudShown(model.phase)
      ? playHudShapes(model, hudLayoutFor(screen), camera)
      : [],
)
