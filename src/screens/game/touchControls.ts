import { Array, Function, Option, Schema, Stream } from 'effect'

import { Mount } from '@effect/ui'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import {
  MEDIC_ICON,
  NEXT_TRAP_ICON,
  RELOAD_ICON,
  TRAP_BUTTON_ICONS,
} from '../../art/icons'
import { QUEST_START_ARROW_ICON } from '../../art/questIcons'
import type { SoundMessage } from '../../audio/message'
import {
  isPocketCardOpened,
  isPocketCardReading,
} from '../../features/dare/pocketCard'
import { isWaitingOnYou } from '../../features/hud/readyNudge'
import { wavePreviewView } from '../../features/hud/wavePreview'
import { isCaseCardUp } from '../../features/onboarding/caseCard'
import { isQuestOnStart } from '../../features/onboarding/firstBreakQuest'
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
import { isKeyboard, percentOf } from '../../ui/menuParts'
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
    children?: ReadonlyArray<ApplicationHtml | null>,
  ): (button: IconButton) => ApplicationHtml
  (
    button: IconButton,
    h: ApplicationViewBuilder,
    children?: ReadonlyArray<ApplicationHtml | null>,
  ): ApplicationHtml
} = Function.dual(
  isButtonFirst,
  (
    button: IconButton,
    h: ApplicationViewBuilder,
    children: ReadonlyArray<ApplicationHtml | null> = [],
  ): ApplicationHtml =>
    h.button
      .attr('type', 'button')
      .class(`icon-button ${button.className}`)
      .attr('aria-label', button.label)
      .attr('aria-keyshortcuts', button.keys)
      .attr(
        'aria-pressed',
        button.maybePressed === undefined
          ? undefined
          : button.maybePressed
            ? 'true'
            : 'false',
      )
      .on('click', button.message)
      .children(
        h.span
          .class('icon-button-glyph')
          .attr('aria-hidden', 'true')
          .style(pixelArtStyle(button.icon)),
        ...children,
      ),
)

const isOnTouch = (model: Model): boolean => model.lastDevice === 'Touch'

const isClusterUp = (model: Model): boolean =>
  isRoundActive(model.phase) &&
  !isDebutCardUp(model) &&
  !isCaseCardUp(model) &&
  !isPocketCardReading(model) &&
  !isPocketCardOpened(model)

const keyBadgeView = (
  model: Model,
  key: string,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  isKeyboard(model)
    ? h.span.class('key-badge').attr('aria-hidden', 'true').children(key)
    : null

// NOTE: a key's cap shows to a keyboard player only: a touch player taps
// and a controller player's buttons get their own pictures later
// (docs/INPUT_PLAN.md, phase 3).

// NOTE: the number key that picks a slot, a small cap in the slot's
// corner on a keyboard only (src/input/keyActions.ts).
const slotNumberView = (
  model: Model,
  number: string,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  isKeyboard(model)
    ? h.span.class('slot-number').attr('aria-hidden', 'true').children(number)
    : null

const keyShortcuts = (keys: ReadonlyArray<string>): string =>
  Array.join(keys, ' ')

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

const SLOT_NUMBER: Readonly<Record<GunSlot, string>> = {
  First: '1',
  Second: '2',
}

const MELEE_NUMBER = '3'

const PRIMARY_MOUSE_BUTTON = 0

// NOTE: every press on a slot, by its pointer's type, before its click. A
// mouse press mid-wave is a shot at the world beneath and its click passes
// through (isSlotPressAShot in src/app/update/play.ts); a touch keeps the tap.
// A Mount, as the element's own `pointerdown` carries no pointer id, and a
// mouse shot is released by its id (ReleasedPointer).
const pressedHudSlotOf = (
  event: PointerEvent,
): Option.Option<PressedHudSlot> =>
  event.pointerType === 'mouse' && event.button !== PRIMARY_MOUSE_BUTTON
    ? Option.none()
    : Option.some(
        InputMessage.PressedHudSlot({
          pointerId: event.pointerId,
          device: event.pointerType === 'mouse' ? 'Mouse' : 'Touch',
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      )

// NOTE: each slot's Mount names its slot, so a Scene can tell them apart
// (src/features/hud/__tests__/mobileHud.scene.test.ts).
export const PressHudSlot = Mount.makeStream(
  'PressHudSlot',
  { args: { slot: Schema.Literals(['First', 'Second', 'Melee']) } },
  (node: HTMLElement) =>
    Stream.fromEventListener<PointerEvent>(node, 'pointerdown').pipe(
      Stream.flatMap(event =>
        Stream.fromIterable(Option.toArray(pressedHudSlotOf(event))),
      ),
    ),
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
): ApplicationHtml => {
  const isHeld =
    !isWieldingMelee(focusOf(model).player) &&
    slot === heldSlotOf(focusOf(model).player.arsenal)
  const maybeKey = gunSlotKey(model, slot)
  return h.button
    .key(slot)
    .attr('type', 'button')
    .class('gun-slot-button')
    .attr('data-slot', slot)
    .attr('data-held', isHeld ? 'true' : 'false')
    .attr('aria-label', isHeld ? `Reload the ${name}` : `Switch to the ${name}`)
    .attr(
      'aria-keyshortcuts',
      keyShortcuts([...Option.toArray(maybeKey), SLOT_NUMBER[slot]]),
    )
    .attr(
      'aria-disabled',
      isHeld && !canReload(focusOf(model).player) ? 'true' : undefined,
    )
    .style(slotSpan(screen, SLOT_INDEX[slot]))
    .onMount(PressHudSlot({ slot }))
    .on('click', RunButtonMessage.ClickedGunSlot({ slot }))
    .children(
      Option.match(maybeKey, {
        onNone: () => null,
        onSome: key => keyBadgeView(model, key, h),
      }),
      slotNumberView(model, SLOT_NUMBER[slot], h),
    )
}

// NOTE: the melee slot, right of the guns: a tap draws the knife or the
// Pan, and a tap on the one in hand does nothing.
const meleeSlotButtonView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const isHeld = isWieldingMelee(focusOf(model).player)
  const name = meleeNameOf(focusOf(model).player)
  return h.button
    .key('Melee')
    .attr('type', 'button')
    .class('gun-slot-button')
    .attr('data-slot', 'Melee')
    .attr('data-held', isHeld ? 'true' : 'false')
    .attr(
      'aria-label',
      isHeld ? `The ${name} is in hand` : `Switch to the ${name}`,
    )
    .attr('aria-keyshortcuts', keyShortcuts(['F', MELEE_NUMBER]))
    .attr('aria-disabled', isHeld ? 'true' : undefined)
    .style(slotSpan(screen, MELEE_SLOT_INDEX))
    .onMount(PressHudSlot({ slot: 'Melee' }))
    .on('click', RunButtonMessage.ClickedMeleeSlot())
    .children(
      isHeld ? null : keyBadgeView(model, 'F', h),
      slotNumberView(model, MELEE_NUMBER, h),
    )
}

const gunSlotsView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div
    .class('gun-slots')
    .attr('role', 'group')
    .attr('aria-label', 'Your guns')
    .attr('data-click', Phase.isAnyOf(['Wave'])(model.phase) ? 'World' : 'Slot')
    .children(
      ...Array.map(slotGuns(model), gun =>
        gunSlotButtonView(model, screen, gun, h),
      ),
      meleeSlotButtonView(model, screen, h),
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
): ApplicationHtml => {
  const gun = gunName(
    model,
    focusSlotOf(model),
    heldWeapon(focusOf(model).player.arsenal),
  )
  const isMeleeOut = isWieldingMelee(focusOf(model).player)
  const isReady = canReload(focusOf(model).player)
  return h.button
    .attr('type', 'button')
    .class('reload-button')
    .attr('data-ready', isReady ? 'true' : 'false')
    .attr('data-layout', screen.layout)
    .attr(
      'aria-label',
      isMeleeOut ? `Draw and reload the ${gun}` : `Reload the ${gun}`,
    )
    .attr('aria-keyshortcuts', 'R')
    .attr('aria-disabled', isReady || isMeleeOut ? undefined : 'true')
    .style(reloadSpot(screen))
    .on('click', RunButtonMessage.ClickedReloadButton())
    .children(
      h.span
        .class('reload-face')
        .attr('aria-hidden', 'true')
        .style({
          width: hudPixels(reloadFaceOf(screen).width),
          height: hudPixels(reloadFaceOf(screen).height),
          ...pixelArtStyle(RELOAD_ICON),
        }),
    )
}

const reloadView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  isOnTouch(model) ? reloadButtonView(model, screen, h) : null

// UTILITY ICONS

const PLACE_REASON_ID = 'place-trap-reason'

const placeReasonView = (
  { verdict }: Placement,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  PlaceVerdict.match(verdict, {
    Placeable: () => null,
    Blocked: ({ reason }) =>
      h.span.id(PLACE_REASON_ID).class('sr-only').children(reason),
  })

const placeIconView = (
  model: Model,
  placement: Placement,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const { kind, verdict } = placement
  const isBlocked = PlaceVerdict.isAnyOf(['Blocked'])(verdict)
  return h.button
    .attr('type', 'button')
    .class('icon-button cluster-button place-icon-button')
    .attr(
      'data-beckon',
      TrapHint.isAnyOf(['Showing'])(model.trapHint) ? 'true' : 'false',
    )
    .attr('aria-label', `Place a ${TRAPS[kind].name}`)
    .attr('aria-keyshortcuts', 'T')
    .attr('aria-disabled', isBlocked ? 'true' : undefined)
    .attr('aria-describedby', isBlocked ? PLACE_REASON_ID : undefined)
    .on('click', RunButtonMessage.ClickedPlaceTrapButton())
    .children(
      h.span
        .class('icon-button-glyph')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(TRAP_BUTTON_ICONS[kind])),
      h.span
        .class('icon-button-badge')
        .attr('aria-hidden', 'true')
        .children(`x${focusOf(model).trapStock[kind]}`),
      keyBadgeView(model, 'T', h),
      placeReasonView(placement, h),
    )
}

const nextTrapIconView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(maybeNextKind(model, focusSlotOf(model)), {
    onNone: () => null,
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
): ReadonlyArray<ApplicationHtml | null> =>
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
// end over the melee slot. In a landscape break they run from the start wave
// button to a right edge 90 pixels past the screen's middle, where the
// stall's left side once stood on a 320 pixel screen. In portrait they end
// over the reload button, and in a break, when the start wave button takes
// the band over the row, one band higher. The touch pill is exactly
// START_WAVE_PX wide, room for START WAVE in its bold monospace with the
// border and a margin, so the column starts one gap past its right edge.
const START_WAVE_PX = 148

const SIDE_RIGHT_PAST_MIDDLE_PX = 90

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
        ? `calc(${percentOf(gunPairWidthOf(screen) / 2, cluster.width)} + ${START_WAVE_PX / 2 + SIDE_GAP_PX}px)`
        : '0px',
      right: isBreak
        ? percentOf(
            cluster.x +
              cluster.width -
              (screen.width / 2 + SIDE_RIGHT_PAST_MIDDLE_PX),
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
const medicButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const { seat } = focusOf(model)
  return isDowned(seat)
    ? h.button
        .attr('type', 'button')
        .class('icon-button cluster-button medic-button')
        .attr('data-fresh', isCallFresh(seat) ? 'true' : 'false')
        .attr('aria-label', MEDIC_WORD)
        .attr('aria-keyshortcuts', 'Enter')
        .on('click', RunButtonMessage.ClickedMedicButton())
        .children(
          h.span
            .class('icon-button-glyph')
            .attr('aria-hidden', 'true')
            .style(pixelArtStyle(MEDIC_ICON)),
          keyBadgeView(model, 'ENTER', h),
        )
    : null
}

const clusterSideView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div
    .class('gun-cluster-side')
    .style(sideStyle(model, screen))
    .children(
      medicButtonView(model, h),
      holdButtonView(model, h),
      ...trapIconsView(model, h),
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

// NOTE: the first break tour's last step (src/features/onboarding/firstBreakQuest.ts):
// a big gold arrow bobs over START WAVE, wherever the layout puts it, with
// the key's cap beside it for a keyboard player. No words.
const startWavePointView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  isQuestOnStart(model)
    ? h.div
        .class('start-wave-point')
        .attr('aria-hidden', 'true')
        .children(
          h.span
            .class('start-wave-point-arrow')
            .style(pixelArtStyle(QUEST_START_ARROW_ICON)),
          isKeyboard(model)
            ? h.span.class('start-wave-point-key').children('ENTER')
            : null,
        )
    : null

const startWaveButtonView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Phase.match(model.phase, {
    Ready: () => null,
    Arriving: () => null,
    Preparation: ({ wave }) =>
      h.div
        .class('gun-cluster-top')
        .style({
          left: percentOf(
            gunPairWidthOf(screen) / 2,
            gunClusterBox(screen).width,
          ),
        })
        .children(
          h.button
            .attr('type', 'button')
            .class(isOnTouch(model) ? 'start-wave-pill' : 'start-wave-button')
            .style(isOnTouch(model) ? { width: `${START_WAVE_PX}px` } : {})
            .attr('aria-label', startWaveLabel(model, wave))
            .attr('data-ready', leadSeatOf(model).readiness)
            .attr('data-beckon', isStartWaveBeckoning(model) ? 'true' : 'false')
            .attr('data-nudge', isWaitingOnYou(model) ? 'true' : 'false')
            .attr('data-tour', isQuestOnStart(model) ? 'true' : 'false')
            .attr('aria-keyshortcuts', 'Enter')
            .on('click', RunButtonMessage.ClickedStartWaveButton())
            .children(startWaveWord(model), keyBadgeView(model, 'ENTER', h)),
          startWavePointView(model, h),
        ),
    Wave: () => null,
    Paused: () => null,
    Escaped: () => null,
    LeftEarly: () => null,
    GameOver: () => null,
  })

// GUN CLUSTER

const clusterView = (
  model: Model,
  screen: Screen,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const cluster = gunClusterBox(screen)
  return h.div.class('hud-tap-frame').children(
    h.div.class('hud-tap-stage').children(
      h.div
        .class('gun-cluster')
        .attr('data-device', model.lastDevice)
        .attr('data-layout', screen.layout)
        .style({
          left: percentOf(cluster.x, screen.width),
          width: percentOf(cluster.width, screen.width),
          bottom: percentOf(
            screen.height - cluster.y - cluster.height,
            screen.height,
          ),
          height: `max(48px, ${percentOf(cluster.height, screen.height)})`,
        })
        .children(
          gunSlotsView(model, screen, h),
          reloadView(model, screen, h),
          clusterSideView(model, screen, h),
          startWaveButtonView(model, screen, h),
        ),
    ),
  )
}

export const gunClusterView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isClusterUp(model) ? clusterView(model, screenOf(model), h) : null,
)

// STICKS

export const stickView: {
  (label: string, h: ApplicationViewBuilder): (stick: Stick) => ApplicationHtml
  (stick: Stick, label: string, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  3,
  (
    stick: Stick,
    label: string,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null =>
    Stick.match(stick, {
      Idle: () => null,
      Active: active => {
        const offset = thumbOffset(active)
        return h.div
          .class('touch-stick')
          .attr('data-stick', label)
          .attr('aria-hidden', 'true')
          .style({
            left: `${active.originX - STICK_RADIUS_PX}px`,
            top: `${active.originY - STICK_RADIUS_PX}px`,
            width: `${STICK_RADIUS_PX * 2}px`,
            height: `${STICK_RADIUS_PX * 2}px`,
          })
          .children(
            h.div.class('touch-stick-thumb').style({
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }),
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
): ApplicationHtml =>
  h.p
    .class('sr-only')
    .attr('role', 'timer')
    .children(
      BreakClock.match(clock, {
        Counting: () =>
          `${secondsLeft(remainingMs)} seconds until wave ${wave}.`,
        Waiting: () => `Wave ${wave} starts when you are ready.`,
      }),
    )

export const preparationControlsView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    Phase.match(model.phase, {
      Ready: () => null,
      Arriving: () => null,
      Preparation: ({ wave, remainingMs, clock }) =>
        h.div.children(
          preparationTimerView(wave, remainingMs, clock, h),
          wavePreviewView(wave, model.boss, h),
        ),
      Wave: () => null,
      Paused: () => null,
      Escaped: () => null,
      LeftEarly: () => null,
      GameOver: () => null,
    }),
)

// GHOST STICKS

const GHOST_LABELS: Readonly<Record<GhostStick, string>> = {
  Move: 'MOVE',
  Aim: 'AIM + SHOOT',
}

export const ghostSticksView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    Array.match(shownGhostSticks(model), {
      onEmpty: () => null,
      onNonEmpty: ghosts =>
        h.div
          .class('ghost-sticks')
          .attr('aria-hidden', 'true')
          .children(
            Array.map(ghosts, ghost =>
              h.div
                .key(ghost)
                .class('ghost-stick')
                .attr('data-ghost', ghost)
                .children(
                  h.div.class('ghost-stick-thumb'),
                  h.span
                    .class('ghost-stick-label')
                    .children(GHOST_LABELS[ghost]),
                ),
            ),
          ),
    }),
)
