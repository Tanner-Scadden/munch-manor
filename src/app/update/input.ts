import { Option, Struct } from 'effect'

import { UiStruct } from '@effect/ui'

import { foldPocketCard } from '../../features/dare/pocketCard'
import {
  type PointerPress,
  keepTouchedSticks,
  moveMouse,
  movePointer,
  pressHoldButton,
  pressPointer,
  releaseKeys,
  releasePointer,
} from '../../input/input'
import type { InputDevice, PointerDevice } from '../../input/inputSchema'
import { noteMissedKeyDown } from '../../input/keyGrab'
import { isTurnHintShown, seeTurnHint } from '../../screens/home/home'
import { isArriving } from '../../world/run/arrival'
import { isRoundActive } from '../../world/waves/waves'
import { refreshIntent } from '../frame'
import { orInRun } from './coopRun'
import { skipFromPointer } from './end'
import { skipIntro } from './intro'
import { padMenuSteps } from './padMenu'
import {
  asAllowedPress,
  clickDareList,
  clickMedic,
  clickNextTrap,
  clickPause,
  clickPlaceTrap,
  clickStartWave,
  isSlotClickPassingThrough,
  isSlotPressAShot,
  notePageVisibility,
  orientationOf,
  padGone,
  pauseWhenAway,
  polledPad,
  pressGunSlot,
  pressMeleeSlot,
  pressedKey,
  releasedKey,
  reloadFromButton,
  resumeFromPointer,
  skipCaseCardWhenUp,
  skipDebutCardWhenUp,
  swapFromButton,
  useDevice,
  withSlotClick,
} from './play'
import { startsRun } from './run'
import { playStartSoundWhen, unlockAudio } from './sound'
import {
  type UpdateStep,
  defineHandlers,
  modelStep,
  toModel,
  withInput,
} from './step'
import { checkForUpdate } from './version'

const deviceOf = (device: PointerDevice): InputDevice =>
  device === 'Touch' ? 'Touch' : 'KeyboardMouse'

const pressedPointer =
  (pointer: PointerPress): UpdateStep =>
  $ => {
    const model = $.model
    const press = asAllowedPress(model, pointer)
    const started = resumeFromPointer(useDevice(model, deviceOf(press.device)))
    const pressed = isArriving(model.phase)
      ? skipIntro(started)
      : isRoundActive(model.phase)
        ? withInput(
            skipCaseCardWhenUp(skipDebutCardWhenUp(foldPocketCard(started))),
            input => pressPointer(input, started.maybeSurface, press),
          )
        : refreshIntent(skipFromPointer(started))
    return $.combine(
      toModel(pressed),
      unlockAudio,
      playStartSoundWhen(startsRun(model, pressed)),
    )
  }

// NOTE: the click after a mouse's shot through a slot (PressedHudSlot) is
// spent, and the next click on a slot acts again.
const passSlotClick = modelStep(model => withSlotClick(model, 'Acts'))

// NOTE: the keyboard, the mouse, touch, and the game surface
// (src/input/message.ts).
export const inputHandlers = defineHandlers({
  PressedKey: ($, message) => orInRun(message, pressedKey(message.code))($),

  ReleasedKey: ($, { code }) => releasedKey(code)($),

  PressedMetaKey: $ => withInput($.model, releaseKeys),

  MissedKeyDown: $ => noteMissedKeyDown($.model),

  PressedPointer: ($, press) => pressedPointer(press)($),

  PressedHudSlot: ($, press) =>
    isSlotPressAShot($.model, press.device)
      ? $.combine(
          modelStep(model => withSlotClick(model, 'PassesThrough')),
          pressedPointer(press),
        )
      : withSlotClick(useDevice($.model, deviceOf(press.device)), 'Acts'),

  MovedPointer: ($, { pointerId, clientX, clientY }) =>
    withInput($.model, input =>
      movePointer(input, $.model.maybeSurface, { pointerId, clientX, clientY }),
    ),

  ReleasedPointer: ($, { pointerId }) =>
    $.combine(
      modelStep(model =>
        withInput(model, input => releasePointer(input, pointerId)),
      ),
      unlockAudio,
    ),

  CancelledPointer: ($, { pointerId }) =>
    withInput($.model, input => releasePointer(input, pointerId)),

  ChangedTouches: ($, { points }) =>
    withInput($.model, input => keepTouchedSticks(input, points)),

  MovedMouse: ($, { clientX, clientY }) =>
    withInput(useDevice($.model, 'KeyboardMouse'), input =>
      moveMouse(input, $.model.maybeSurface, { x: clientX, y: clientY }),
    ),

  SuppressedContextMenu: $ => $.model,

  // NOTE: the touch tap listener (src/input/touchTaps.ts) reports each tap it
  // made. The tapped button's own Message did the work.
  TappedWithTouch: $ => $.model,

  // NOTE: turning the phone while the turn hint is up is the hint done.
  MeasuredGameSurface: ($, message) => {
    const measured = UiStruct.evolve($.model, {
      maybeSurface: () => Option.some(Struct.omit(message, ['_tag'])),
      orientation: () => orientationOf(message.width, message.height),
    })
    return isTurnHintShown($.model) && !isTurnHintShown(measured)
      ? seeTurnHint(measured)
      : measured
  },

  CompletedDetectInputDevice: ($, { touchControls }) =>
    useDevice(
      UiStruct.evolve($.model, { touchControls: () => touchControls }),
      touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
    ),

  // NOTE: the pad's own presses first, then its menu presses, routed by
  // the menu that was up before this poll (src/app/update/padMenu.ts).
  PolledGamepad: ($, message) => {
    const pad = {
      index: message.index,
      axes: message.axes,
      buttons: message.buttons,
    }
    return $.combine(
      orInRun(message, polledPad(pad)),
      ...padMenuSteps({ model: $.model, pad }),
    )
  },

  DisconnectedGamepad: ($, message) =>
    orInRun(message, padGone(message.index))($),
})

// NOTE: the run's buttons (src/input/message.ts), each sent to the room in
// an online run.
export const runButtonHandlers = defineHandlers({
  // NOTE: the finger holds the interact until it lifts.
  PressedHoldButton: ($, message) =>
    $.combine(
      modelStep(held =>
        withInput(useDevice(held, 'Touch'), input =>
          pressHoldButton(input, message.pointerId),
        ),
      ),
      unlockAudio,
    ),

  ClickedPauseButton: ($, message) => orInRun(message, clickPause)($),

  ClickedStartWaveButton: ($, message) => orInRun(message, clickStartWave)($),

  ClickedSwapButton: ($, message) => orInRun(message, swapFromButton)($),

  ClickedGunSlot: ($, message) =>
    isSlotClickPassingThrough($.model)
      ? passSlotClick($)
      : orInRun(message, pressGunSlot(message.slot))($),

  ClickedMeleeSlot: ($, message) =>
    isSlotClickPassingThrough($.model)
      ? passSlotClick($)
      : orInRun(message, pressMeleeSlot)($),

  // NOTE: on touch the reload button is a tap like any button, made into a
  // click by src/input/touchTaps.ts even with a thumb on the move stick.
  ClickedReloadButton: ($, message) => orInRun(message, reloadFromButton)($),

  // NOTE: MEDIC! from a downed player, a tap on the red cross.
  ClickedMedicButton: ($, message) => orInRun(message, clickMedic)($),

  ClickedPlaceTrapButton: ($, message) => orInRun(message, clickPlaceTrap)($),

  ClickedNextTrapButton: ($, message) => orInRun(message, clickNextTrap)($),

  // NOTE: the HUD's dare list opens the dare card again, alone or online:
  // this client's own (src/app/update/play.ts).
  ClickedDareList: $ => clickDareList($),
})

// NOTE: the page's focus, visibility, and a restore from the cache
// (src/platform/message.ts).
export const pageHandlers = defineHandlers({
  BlurredWindow: ($, message) => orInRun(message, pauseWhenAway)($),

  FocusedWindow: $ => checkForUpdate($),

  ChangedPageVisibility: ($, message) =>
    orInRun(message, notePageVisibility(message.visibility))($),

  RestoredPageFromCache: $ => checkForUpdate($),
})
