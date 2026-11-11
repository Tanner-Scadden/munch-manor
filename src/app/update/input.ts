import { Option, Struct } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { foldPocketCard } from '../../features/dare/pocketCard'
import {
  type PointerPress,
  moveMouse,
  movePointer,
  pressHoldButton,
  pressPointer,
  releaseKeys,
  releasePointer,
  releaseSticks,
} from '../../input/input'
import type { InputDevice, PointerDevice } from '../../input/inputSchema'
import { noteMissedKeyDown } from '../../input/keyGrab'
import { isTurnHintShown, seeTurnHint } from '../../screens/home/home'
import { isArriving } from '../../world/run/arrival'
import { isRoundActive } from '../../world/waves/waves'
import { makeStep } from '../definition'
import { refreshIntent } from '../frame'
import type { Model } from '../model'
import { orInRun } from './coopRun'
import { skipFromPointer } from './end'
import { skipIntro } from './intro'
import {
  asAllowedPress,
  clickMedic,
  clickNextTrap,
  clickPause,
  clickPlaceTrap,
  clickStartWave,
  isSlotClickPassingThrough,
  isSlotPressAShot,
  notePageVisibility,
  orientationOf,
  pauseWhenAway,
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
  type UpdateReturn,
  combine,
  defineHandlers,
  modelStep,
  withInput,
} from './step'
import { checkForUpdate } from './version'

const deviceOf = (device: PointerDevice): InputDevice =>
  device === 'Touch' ? 'Touch' : 'KeyboardMouse'

const pressedPointer = (model: Model, pointer: PointerPress): UpdateReturn => {
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
  return combine(pressed, [
    unlockAudio,
    playStartSoundWhen(startsRun(model, pressed)),
  ])
}

// NOTE: the click after a mouse's shot through a slot (PressedHudSlot) is
// spent, and the next click on a slot acts again.
const passSlotClick = (model: Model): UpdateReturn => ({
  model: withSlotClick(model, 'Acts'),
})

// NOTE: the keyboard, the mouse, touch, and the game surface
// (src/input/message.ts).
export const inputHandlers = defineHandlers({
  PressedKey: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, pressedKey(message.code))),
    ]),

  ReleasedKey: (model, { code }) =>
    Update.combineSteps(model, [releasedKey(code)]),

  PressedMetaKey: model => ({ model: withInput(model, releaseKeys) }),

  MissedKeyDown: model => ({ model: noteMissedKeyDown(model) }),

  PressedPointer: (model, press) => pressedPointer(model, press),

  PressedHudSlot: (model, press) =>
    isSlotPressAShot(model, press.device)
      ? pressedPointer(withSlotClick(model, 'PassesThrough'), press)
      : {
          model: withSlotClick(
            useDevice(model, deviceOf(press.device)),
            'Acts',
          ),
        },

  MovedPointer: (model, { pointerId, clientX, clientY }) => ({
    model: withInput(model, input =>
      movePointer(input, model.maybeSurface, { pointerId, clientX, clientY }),
    ),
  }),

  ReleasedPointer: (model, { pointerId }) =>
    unlockAudio(withInput(model, input => releasePointer(input, pointerId))),

  CancelledPointer: (model, { pointerId }) => ({
    model: withInput(model, input => releasePointer(input, pointerId)),
  }),

  ReleasedEveryTouch: model => ({ model: withInput(model, releaseSticks) }),

  MovedMouse: (model, { clientX, clientY }) => ({
    model: withInput(useDevice(model, 'KeyboardMouse'), input =>
      moveMouse(input, model.maybeSurface, { x: clientX, y: clientY }),
    ),
  }),

  SuppressedContextMenu: model => ({ model }),

  // NOTE: the touch tap listener (src/input/touchTaps.ts) reports each tap it
  // made. The tapped button's own Message did the work.
  TappedWithTouch: model => ({ model }),

  // NOTE: turning the phone while the turn hint is up is the hint done.
  MeasuredGameSurface: (model, message) => {
    const measured = modifyFields(model, {
      maybeSurface: () => Option.some(Struct.omit(message, ['_tag'])),
      orientation: () => orientationOf(message.width, message.height),
    })
    return {
      model:
        isTurnHintShown(model) && !isTurnHintShown(measured)
          ? seeTurnHint(measured)
          : measured,
    }
  },

  CompletedDetectInputDevice: (model, { touchControls }) => ({
    model: useDevice(
      modifyFields(model, { touchControls: () => touchControls }),
      touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
    ),
  }),
})

// NOTE: the run's buttons (src/input/message.ts), each sent to the room in
// an online run.
export const runButtonHandlers = defineHandlers({
  // NOTE: the finger holds the interact until it lifts.
  PressedHoldButton: (model, message) =>
    Update.combineSteps(model, [
      modelStep(held =>
        withInput(useDevice(held, 'Touch'), input =>
          pressHoldButton(input, message.pointerId),
        ),
      ),
      unlockAudio,
    ]),

  ClickedPauseButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickPause))]),

  ClickedStartWaveButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickStartWave))]),

  ClickedSwapButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, swapFromButton))]),

  ClickedGunSlot: (model, message) =>
    isSlotClickPassingThrough(model)
      ? passSlotClick(model)
      : Update.combineSteps(model, [
          makeStep(orInRun(message, pressGunSlot(message.slot))),
        ]),

  ClickedMeleeSlot: (model, message) =>
    isSlotClickPassingThrough(model)
      ? passSlotClick(model)
      : Update.combineSteps(model, [
          makeStep(orInRun(message, pressMeleeSlot)),
        ]),

  // NOTE: on touch the reload button is a tap like any button, made into a
  // click by src/input/touchTaps.ts even with a thumb on the move stick.
  ClickedReloadButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, reloadFromButton))]),

  // NOTE: MEDIC! from a downed player, a tap on the red cross.
  ClickedMedicButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickMedic))]),

  ClickedPlaceTrapButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickPlaceTrap))]),

  ClickedNextTrapButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickNextTrap))]),
})

// NOTE: the page's focus, visibility, and a restore from the cache
// (src/platform/message.ts).
export const pageHandlers = defineHandlers({
  BlurredWindow: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, pauseWhenAway))]),

  FocusedWindow: model => checkForUpdate(model),

  ChangedPageVisibility: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, notePageVisibility(message.visibility))),
    ]),

  RestoredPageFromCache: model => checkForUpdate(model),
})
