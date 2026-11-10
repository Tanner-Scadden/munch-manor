import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import {
  MEDIC_ICON,
  NEXT_TRAP_ICON,
  RELOAD_ICON,
  TRAP_BUTTON_ICONS,
} from '../../art/icons'
import type { SoundMessage } from '../../audio/message'
import { isWaitingOnYou } from '../../features/hud/readyNudge'
import { wavePreviewView } from '../../features/hud/wavePreview'
import {
  type GhostStick,
  isDebutCardUp,
  isStartWaveBeckoning,
  shownGhostSticks,
} from '../../features/onboarding/onboarding'
import { holdButtonView } from '../../features/shop/purchaseHud'
import { thumbOffset } from '../../input/input'
import { Stick } from '../../input/inputSchema'
import {
  InputMessage,
  type PressedHudSlot,
  RunButtonMessage,
} from '../../input/message'
import type { DeviceMessage } from '../../platform/message'
import {
  MELEE_SLOT_INDEX,
  SLOT_GAP,
  gunClusterBox,
  gunPairWidthOf,
  gunSlotBox,
  reloadFaceOf,
} from '../../render/hudLayout'
import { type Screen, screenOf } from '../../render/screen'
import { STICK_RADIUS_PX } from '../../shared/constants'
import { percentOf } from '../../ui/menuParts'
import { gunName } from '../../world/gear/gunLevels'
import {
  PlaceVerdict,
  type Placement,
  TRAPS,
  maybeNextKind,
  maybePlacement,
} from '../../world/gear/traps'
import {
  canReload,
  gunsOf,
  heldSlotOf,
  heldWeapon,
  isWieldingMelee,
  meleeNameOf,
  tierName,
} from '../../world/gear/weapons'
import { RATTLES_BOX } from '../../world/level/arena'
import { MEDIC_WORD } from '../../world/names'
import { isCallFresh } from '../../world/party/medic'
import {
  focusOf,
  focusSlotOf,
  isCoop,
  isDowned,
  leadSeatOf,
} from '../../world/party/party'
import {
  BreakClock,
  GunSlot,
  Phase,
  TrapHint,
} from '../../world/schema/worldSchema'
import { isRoundActive } from '../../world/waves/waves'
import { secondsLeft } from './hud'

// ICON BUTTONS

// NOTE: an icon button's side, as .icon-button in src/app/styles.css.
const ICON_BUTTON_PX = 48

// NOTE: the gap between the row and the buttons stacked over it.
const SIDE_GAP_PX = 4

type IconButton = Readonly<{
  className: string
  label: string
  icon: string
  keys?: string
  message: RunButtonMessage | SoundMessage | DeviceMessage
  maybePressed?: boolean
}>

// NOTE: a call is data-first when its second argument is the view builder;
// in the data-last form it is the children (an array), or missing.
const isButtonFirst = (args: IArguments): boolean =>
  args.length >= 2 && !Array.isArray(args[1])

export const iconButtonView: {
  (
    h: ApplicationViewBuilder,
    children?: ReadonlyArray<Html>,
  ): (button: IconButton) => Html
  (
    button: IconButton,
    h: ApplicationViewBuilder,
    children?: ReadonlyArray<Html>,
  ): Html
} = Function.dual(
  isButtonFirst,
  (
    button: IconButton,
    h: ApplicationViewBuilder,
    children: ReadonlyArray<Html> = [],
  ): Html =>
    h.button(
      [
        h.Type('button'),
        h.Class(`icon-button ${button.className}`),
        h.AriaLabel(button.label),
        ...(button.keys === undefined ? [] : [h.AriaKeyshortcuts(button.keys)]),
        ...(button.maybePressed === undefined
          ? []
          : [h.AriaPressed(button.maybePressed ? 'true' : 'false')]),
        h.OnClick(button.message, { focusSelector: '.game-surface' }),
      ],
      [
        h.span([
          h.Class('icon-button-glyph'),
          h.AriaHidden(true),
          h.Style({ backgroundImage: button.icon }),
        ]),
        ...children,
      ],
    ),
)

const isOnTouch = (model: Model): boolean => model.lastDevice === 'Touch'

const isClusterUp = (model: Model): boolean =>
  isRoundActive(model.phase) && !isDebutCardUp(model)

const keyBadgeView = (
  model: Model,
  key: string,
  h: ApplicationViewBuilder,
): Html =>
  isOnTouch(model)
    ? h.empty
    : h.span([h.Class('key-badge'), h.AriaHidden(true)], [key])

// GUN SLOTS

type SlotGun = Readonly<{ slot: GunSlot; name: string }>

const SLOT_ORDER = GunSlot.literals

const slotGuns = (model: Model): ReadonlyArray<SlotGun> =>
  Array.zipWith(
    SLOT_ORDER,
    gunsOf(focusOf(model).player.arsenal),
    (slot, gun) => ({
      slot,
      name: tierName(gun.kind, gun.tier),
    }),
  )

const SLOT_INDEX: Readonly<Record<GunSlot, number>> = { First: 0, Second: 1 }

const PRIMARY_MOUSE_BUTTON = 0

// NOTE: every press on a slot, by its pointer's type, before its click. A
// mouse press mid-wave is a shot at the world beneath and its click passes
// through (isSlotPressAShot in src/app/update/play.ts); a touch keeps the tap.
const toPressedHudSlot = (
  pointerType: string,
  button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  clientX: number,
  clientY: number,
  pointerId: number,
): Option.Option<PressedHudSlot> =>
  pointerType === 'mouse' && button !== PRIMARY_MOUSE_BUTTON
    ? Option.none()
    : Option.some(
        InputMessage.PressedHudSlot({
          pointerId,
          device: pointerType === 'mouse' ? 'Mouse' : 'Touch',
          clientX,
          clientY,
        }),
      )

// NOTE: the key that reaches a gun slot: R reloads the held gun, Q swaps
// to the other; with the knife out, Q goes back to the last gun held.
const gunSlotKey = (model: Model, slot: GunSlot): Option.Option<string> => {
  const isLastHeld = slot === heldSlotOf(focusOf(model).player.arsenal)
  if (isWieldingMelee(focusOf(model).player)) {
    return isLastHeld ? Option.some('Q') : Option.none()
  } else {
    return Option.some(isLastHeld ? 'R' : 'Q')
  }
}

const slotSpan = (
  screen: Screen,
  index: number,
): Readonly<{ left: string; width: string }> => {
  const box = gunSlotBox(screen, index)
  const cluster = gunClusterBox(screen)
  return {
    left: percentOf(box.x - cluster.x, cluster.width),
    width: percentOf(box.width, cluster.width),
  }
}

const gunSlotButtonView = (
  model: Model,
  screen: Screen,
  { slot, name }: SlotGun,
  h: ApplicationViewBuilder,
): Html => {
  const isHeld =
    !isWieldingMelee(focusOf(model).player) &&
    slot === heldSlotOf(focusOf(model).player.arsenal)
  const maybeKey = gunSlotKey(model, slot)
  return h.keyed('button')(
    slot,
    [
      h.Type('button'),
      h.Class('gun-slot-button'),
      h.DataAttribute('slot', slot),
      h.DataAttribute('held', isHeld ? 'true' : 'false'),
      h.AriaLabel(isHeld ? `Reload the ${name}` : `Switch to the ${name}`),
      ...Option.match(maybeKey, {
        onNone: () => [],
        onSome: key => [h.AriaKeyshortcuts(key)],
      }),
      ...(isHeld && !canReload(focusOf(model).player)
        ? [h.AriaDisabled(true)]
        : []),
      h.Style(slotSpan(screen, SLOT_INDEX[slot])),
      h.OnPointerDown(toPressedHudSlot),
      h.OnClick(RunButtonMessage.ClickedGunSlot({ slot }), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      Option.match(maybeKey, {
        onNone: () => h.empty,
        onSome: key => keyBadgeView(model, key, h),
      }),
    ],
  )
}

// NOTE: the melee slot, right of the guns: a tap draws the knife or the
// Pan, and a tap on the one in hand does nothing.
const meleeSlotButtonView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html => {
  const isHeld = isWieldingMelee(focusOf(model).player)
  const name = meleeNameOf(focusOf(model).player)
  return h.keyed('button')(
    'Melee',
    [
      h.Type('button'),
      h.Class('gun-slot-button'),
      h.DataAttribute('slot', 'Melee'),
      h.DataAttribute('held', isHeld ? 'true' : 'false'),
      h.AriaLabel(isHeld ? `The ${name} is in hand` : `Switch to the ${name}`),
      h.AriaKeyshortcuts('F'),
      ...(isHeld ? [h.AriaDisabled(true)] : []),
      h.Style(slotSpan(screen, MELEE_SLOT_INDEX)),
      h.OnPointerDown(toPressedHudSlot),
      h.OnClick(RunButtonMessage.ClickedMeleeSlot(), {
        focusSelector: '.game-surface',
      }),
    ],
    [isHeld ? h.empty : keyBadgeView(model, 'F', h)],
  )
}

const gunSlotsView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [
      h.Class('gun-slots'),
      h.Role('group'),
      h.AriaLabel('Your guns'),
      h.DataAttribute(
        'click',
        Phase.isAnyOf(['Wave'])(model.phase) ? 'World' : 'Slot',
      ),
    ],
    [
      ...Array.map(slotGuns(model), gun =>
        gunSlotButtonView(model, screen, gun, h),
      ),
      meleeSlotButtonView(model, screen, h),
    ],
  )

// RELOAD

// NOTE: on touch the reload button is always in the row, past the melee
// slot. Its face is one more slot in the HUD's own pixels (--hud-px): a
// short one in landscape, a square the row's height in portrait, where the
// row stacks to fit four on a phone held upright (SLOT_SIZES in src/screens/game/hud.ts).
// Its target is at least a thumb wide. It reloads the held gun, or with the
// knife or the Pan out puts the last gun back and reloads it, as R does. It
// dims when a reload would load nothing: a full magazine, the Pan, or a
// reload going.
const hudPixels = (count: number): string => `calc(${count} * var(--hud-px))`

const reloadWidth = (screen: Screen): string =>
  `max(${ICON_BUTTON_PX}px, ${hudPixels(reloadFaceOf(screen).width)})`

// NOTE: from the right of the row's cluster (guns and melee) to the reload
// button's right edge.
const pastReload = (screen: Screen): string =>
  `calc(-${percentOf(SLOT_GAP, gunClusterBox(screen).width)} - ${reloadWidth(screen)})`

const reloadSpot = (screen: Screen): Readonly<Record<string, string>> => ({
  left: `calc(100% + ${percentOf(SLOT_GAP, gunClusterBox(screen).width)})`,
  bottom: '0px',
  width: reloadWidth(screen),
  height: '100%',
})

const reloadButtonView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html => {
  const gun = gunName(
    model,
    focusSlotOf(model),
    heldWeapon(focusOf(model).player.arsenal),
  )
  const isMeleeOut = isWieldingMelee(focusOf(model).player)
  const isReady = canReload(focusOf(model).player)
  return h.button(
    [
      h.Type('button'),
      h.Class('reload-button'),
      h.DataAttribute('ready', isReady ? 'true' : 'false'),
      h.DataAttribute('layout', screen.layout),
      h.AriaLabel(
        isMeleeOut ? `Draw and reload the ${gun}` : `Reload the ${gun}`,
      ),
      h.AriaKeyshortcuts('R'),
      ...(isReady || isMeleeOut ? [] : [h.AriaDisabled(true)]),
      h.Style(reloadSpot(screen)),
      h.OnClick(RunButtonMessage.ClickedReloadButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      h.span([
        h.Class('reload-face'),
        h.AriaHidden(true),
        h.Style({
          width: hudPixels(reloadFaceOf(screen).width),
          height: hudPixels(reloadFaceOf(screen).height),
          backgroundImage: RELOAD_ICON,
        }),
      ]),
    ],
  )
}

const reloadView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html => (isOnTouch(model) ? reloadButtonView(model, screen, h) : h.empty)

// UTILITY ICONS

const PLACE_REASON_ID = 'place-trap-reason'

const placeReasonView = (
  { verdict }: Placement,
  h: ApplicationViewBuilder,
): Html =>
  PlaceVerdict.match(verdict, {
    Placeable: () => h.empty,
    Blocked: ({ reason }) =>
      h.span([h.Id(PLACE_REASON_ID), h.Class('sr-only')], [reason]),
  })

const placeIconView = (
  model: Model,
  placement: Placement,
  h: ApplicationViewBuilder,
): Html => {
  const { kind, verdict } = placement
  const isBlocked = PlaceVerdict.isAnyOf(['Blocked'])(verdict)
  return h.button(
    [
      h.Type('button'),
      h.Class('icon-button cluster-button place-icon-button'),
      h.DataAttribute(
        'beckon',
        TrapHint.isAnyOf(['Showing'])(model.trapHint) ? 'true' : 'false',
      ),
      h.AriaLabel(`Place a ${TRAPS[kind].name}`),
      h.AriaKeyshortcuts('T'),
      ...(isBlocked
        ? [h.AriaDisabled(true), h.AriaDescribedBy(PLACE_REASON_ID)]
        : []),
      h.OnClick(RunButtonMessage.ClickedPlaceTrapButton(), {
        focusSelector: '.game-surface',
      }),
    ],
    [
      h.span([
        h.Class('icon-button-glyph'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: TRAP_BUTTON_ICONS[kind] }),
      ]),
      h.span(
        [h.Class('icon-button-badge'), h.AriaHidden(true)],
        [`x${focusOf(model).trapStock[kind]}`],
      ),
      keyBadgeView(model, 'T', h),
      placeReasonView(placement, h),
    ],
  )
}

const nextTrapIconView = (model: Model, h: ApplicationViewBuilder): Html =>
  Option.match(maybeNextKind(model, focusSlotOf(model)), {
    onNone: () => h.empty,
    onSome: kind =>
      iconButtonView(
        {
          className: 'cluster-button next-trap-icon-button',
          label: `Switch to the ${TRAPS[kind].name}`,
          icon: NEXT_TRAP_ICON,
          keys: 'G',
          message: RunButtonMessage.ClickedNextTrapButton(),
        },
        h,
        [keyBadgeView(model, 'G', h)],
      ),
  })

const trapIconsView = (
  model: Model,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> =>
  Phase.isAnyOf(['Preparation'])(model.phase)
    ? Option.match(maybePlacement(model, focusSlotOf(model)), {
        onNone: () => [],
        onSome: placement => [
          placeIconView(model, placement, h),
          nextTrapIconView(model, h),
        ],
      })
    : []

// NOTE: the hold-to-buy and trap buttons sit over the row, right-aligned,
// and wrap upward, so they never cover a slot, the reload button, or the
// start wave button centered over the guns. Mid-wave (only hold-to-buy) they
// end over the melee slot. In a landscape break they run from the start wave button to short
// of the stall. In portrait they end over the reload button, and in a break,
// when the start wave button takes the band over the row, one band higher.
const START_WAVE_HALF_PX = 64
const STALL_CLEARANCE = 10

const sideStyle = (
  model: Model,
  screen: Screen,
): Readonly<Record<string, string>> => {
  const cluster = gunClusterBox(screen)
  const bottom = `calc(100% + ${SIDE_GAP_PX}px)`
  const isBreak = Phase.isAnyOf(['Preparation'])(model.phase)
  if (screen.layout === 'Landscape') {
    return {
      left: isBreak
        ? `calc(${percentOf(gunPairWidthOf(screen) / 2, cluster.width)} + ${START_WAVE_HALF_PX}px)`
        : '0px',
      right: isBreak
        ? percentOf(
            cluster.x + cluster.width - (RATTLES_BOX.left - STALL_CLEARANCE),
            cluster.width,
          )
        : '0px',
      bottom,
    }
  } else {
    return {
      left: '0px',
      right: isOnTouch(model) ? pastReload(screen) : '0px',
      bottom: isBreak
        ? `calc(100% + ${2 * SIDE_GAP_PX + ICON_BUTTON_PX}px)`
        : bottom,
    }
  }
}

// MEDIC

// NOTE: a downed player's MEDIC! (src/world/party/medic.ts): a red cross over the row,
// there only while they are down. It glows while the last shout still
// rings, and a tap while it cools does nothing.
const medicButtonView = (model: Model, h: ApplicationViewBuilder): Html => {
  const { seat } = focusOf(model)
  return isDowned(seat)
    ? h.button(
        [
          h.Type('button'),
          h.Class('icon-button cluster-button medic-button'),
          h.DataAttribute('fresh', isCallFresh(seat) ? 'true' : 'false'),
          h.AriaLabel(MEDIC_WORD),
          h.AriaKeyshortcuts('Enter'),
          h.OnClick(RunButtonMessage.ClickedMedicButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        [
          h.span([
            h.Class('icon-button-glyph'),
            h.AriaHidden(true),
            h.Style({ backgroundImage: MEDIC_ICON }),
          ]),
          keyBadgeView(model, 'ENTER', h),
        ],
      )
    : h.empty
}

const clusterSideView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('gun-cluster-side'), h.Style(sideStyle(model, screen))],
    [
      medicButtonView(model, h),
      holdButtonView(model, h),
      ...trapIconsView(model, h),
    ],
  )

// START WAVE

// NOTE: in co-op the button is the player's READY, and it says so once
// pressed while the others still choose (decided 7).
const startWaveWord = (model: Model): string => {
  if (!isCoop(model)) {
    return 'START WAVE'
  }
  return leadSeatOf(model).readiness === 'Ready' ? 'READY!' : 'READY'
}

const startWaveLabel = (model: Model, wave: number): string => {
  if (!isCoop(model)) {
    return `Start wave ${wave} now`
  }
  return leadSeatOf(model).readiness === 'Ready'
    ? 'Ready, waiting for the others'
    : `Ready for wave ${wave}`
}

const startWaveButtonView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave }) =>
      h.div(
        [
          h.Class('gun-cluster-top'),
          h.Style({
            left: percentOf(
              gunPairWidthOf(screen) / 2,
              gunClusterBox(screen).width,
            ),
          }),
        ],
        [
          h.button(
            [
              h.Type('button'),
              h.Class(
                isOnTouch(model) ? 'start-wave-pill' : 'start-wave-button',
              ),
              h.AriaLabel(startWaveLabel(model, wave)),
              h.DataAttribute('ready', leadSeatOf(model).readiness),
              h.DataAttribute(
                'beckon',
                isStartWaveBeckoning(model) ? 'true' : 'false',
              ),
              h.DataAttribute(
                'nudge',
                isWaitingOnYou(model) ? 'true' : 'false',
              ),
              h.AriaKeyshortcuts('Enter'),
              h.OnClick(RunButtonMessage.ClickedStartWaveButton(), {
                focusSelector: '.game-surface',
              }),
            ],
            [startWaveWord(model), keyBadgeView(model, 'ENTER', h)],
          ),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Escaped: () => h.empty,
    GameOver: () => h.empty,
  })

// GUN CLUSTER

const clusterView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): Html => {
  const cluster = gunClusterBox(screen)
  return h.div(
    [h.Class('hud-tap-frame')],
    [
      h.div(
        [h.Class('hud-tap-stage')],
        [
          h.div(
            [
              h.Class('gun-cluster'),
              h.DataAttribute('device', model.lastDevice),
              h.DataAttribute('layout', screen.layout),
              h.Style({
                left: percentOf(cluster.x, screen.width),
                width: percentOf(cluster.width, screen.width),
                bottom: percentOf(
                  screen.height - cluster.y - cluster.height,
                  screen.height,
                ),
                height: `max(48px, ${percentOf(cluster.height, screen.height)})`,
              }),
            ],
            [
              gunSlotsView(model, screen, h),
              reloadView(model, screen, h),
              clusterSideView(model, screen, h),
              startWaveButtonView(model, screen, h),
            ],
          ),
        ],
      ),
    ],
  )
}

export const gunClusterView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  isClusterUp(model) ? clusterView(model, screenOf(model), h) : h.empty,
)

// STICKS

export const stickView: {
  (label: string, h: ApplicationViewBuilder): (stick: Stick) => Html
  (stick: Stick, label: string, h: ApplicationViewBuilder): Html
} = Function.dual(
  3,
  (stick: Stick, label: string, h: ApplicationViewBuilder): Html =>
    Stick.match(stick, {
      Idle: () => h.empty,
      Active: active => {
        const offset = thumbOffset(active)
        return h.div(
          [
            h.Class('touch-stick'),
            h.DataAttribute('stick', label),
            h.AriaHidden(true),
            h.Style({
              left: `${active.originX - STICK_RADIUS_PX}px`,
              top: `${active.originY - STICK_RADIUS_PX}px`,
              width: `${STICK_RADIUS_PX * 2}px`,
              height: `${STICK_RADIUS_PX * 2}px`,
            }),
          ],
          [
            h.div([
              h.Class('touch-stick-thumb'),
              h.Style({
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }),
            ]),
          ],
        )
      },
    }),
)

// PREPARATION

const preparationTimerView = (
  wave: number,
  remainingMs: number,
  clock: BreakClock,
  h: ApplicationViewBuilder,
): Html =>
  h.p(
    [h.Class('sr-only'), h.Role('timer')],
    [
      BreakClock.match(clock, {
        Counting: () =>
          `${secondsLeft(remainingMs)} seconds until wave ${wave}.`,
        Waiting: () => `Wave ${wave} starts when you are ready.`,
      }),
    ],
  )

export const preparationControlsView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  Phase.match(model.phase, {
    Ready: () => h.empty,
    Preparation: ({ wave, remainingMs, spawns, clock }) =>
      h.div(
        [],
        [
          preparationTimerView(wave, remainingMs, clock, h),
          wavePreviewView(wave, spawns, model.traps, model.boss, h),
        ],
      ),
    Wave: () => h.empty,
    Paused: () => h.empty,
    Escaped: () => h.empty,
    GameOver: () => h.empty,
  }),
)

// GHOST STICKS

const GHOST_LABELS: Readonly<Record<GhostStick, string>> = {
  Move: 'MOVE',
  Aim: 'AIM + SHOOT',
}

export const ghostSticksView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  Array.match(shownGhostSticks(model), {
    onEmpty: () => h.empty,
    onNonEmpty: ghosts =>
      h.div(
        [h.Class('ghost-sticks'), h.AriaHidden(true)],
        Array.map(ghosts, ghost =>
          h.keyed('div')(
            ghost,
            [h.Class('ghost-stick'), h.DataAttribute('ghost', ghost)],
            [
              h.div([h.Class('ghost-stick-thumb')]),
              h.span([h.Class('ghost-stick-label')], [GHOST_LABELS[ghost]]),
            ],
          ),
        ),
      ),
  }),
)
