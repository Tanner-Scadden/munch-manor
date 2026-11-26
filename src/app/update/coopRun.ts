import { Array, Function, Match, Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'

import { isRunOn } from '../../domain/onlineRun'
import { foldPocketCard } from '../../features/dare/pocketCard'
import { isPauseKey, pressKey, releaseAll } from '../../input/input'
import type { Gamepad, InputDevice } from '../../input/inputSchema'
import { playerKeyAction } from '../../input/keyActions'
import type { PageVisibility } from '../../platform/deviceSchema'
import { focusOf } from '../../world/party/party'
import { isArriving } from '../../world/run/arrival'
import { SeatAction, gunSlotAction } from '../../world/step/stepWorld'
import { Message } from '../message'
import type { Model } from '../model'
import { pressInRoom } from './coop'
import { skipIntro } from './intro'
import {
  dareListFromKey,
  forgetPad,
  isDareListKey,
  notePad,
  padPresses,
} from './play'
import { toggleAudioFromKey, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  modelStep,
  unchanged,
  withInput,
} from './step'

const pressInRun = (action: SeatAction): UpdateStep =>
  combine([unlockAudio, pressInRoom(action)])

const holdKey =
  (code: string, device: InputDevice): UpdateStep =>
  $ =>
    withInput(
      UiStruct.evolve(toggleAudioFromKey($.model, code), {
        lastDevice: () => device,
      }),
      input => (isPauseKey(code) ? input : pressKey(input, code)),
    )

const keyInRun =
  (code: string, device: InputDevice): UpdateStep =>
  $ => {
    const model = $.model
    if (isArriving(model.phase)) {
      return $.combine(holdKey(code, device), modelStep(skipIntro), unlockAudio)
    } else if (isDareListKey(model, code)) {
      return dareListFromKey(code)($)
    } else {
      return Option.match(playerKeyAction(model, code), {
        onNone: () =>
          $.combine(
            modelStep(foldPocketCard),
            holdKey(code, device),
            unlockAudio,
          ),
        onSome: action =>
          $.combine(
            modelStep(foldPocketCard),
            holdKey(code, device),
            pressInRun(action),
          ),
      })
    }
  }

const padInRun =
  (pad: Gamepad): UpdateStep =>
  $ =>
    $.combine(
      modelStep(notePad(pad)),
      ...Array.map(padPresses($.model, pad), code => keyInRun(code, 'Gamepad')),
    )

const padGoneInRun = modelStep(model => withInput(forgetPad(model), releaseAll))

const blurInRun = modelStep(model => withInput(model, releaseAll))

const pageVisibilityInRun = (visibility: PageVisibility) =>
  modelStep(model =>
    withInput(
      UiStruct.evolve(model, { pageVisibility: () => visibility }),
      releaseAll,
    ),
  )

const RunMessage = Schema.Union([
  Message.cases.TickedFrame,
  Message.cases.PressedKey,
  Message.cases.PolledGamepad,
  Message.cases.DisconnectedGamepad,
  Message.cases.BlurredWindow,
  Message.cases.ChangedPageVisibility,
  Message.cases.ClickedPauseButton,
  Message.cases.ClickedStartWaveButton,
  Message.cases.ClickedSwapButton,
  Message.cases.ClickedGunSlot,
  Message.cases.ClickedMeleeSlot,
  Message.cases.ClickedReloadButton,
  Message.cases.ClickedPlaceTrapButton,
  Message.cases.ClickedNextTrapButton,
  Message.cases.ClickedMedicButton,
])
type RunMessage = typeof RunMessage.Type

const inRun = (model: Model, message: RunMessage): UpdateStep =>
  Match.valueTags(message, {
    TickedFrame: () => unchanged,
    PressedKey: ({ code }) => keyInRun(code, 'KeyboardMouse'),
    PolledGamepad: ({ index, axes, buttons }) =>
      padInRun({ index, axes, buttons }),
    DisconnectedGamepad: () => padGoneInRun,
    BlurredWindow: () => blurInRun,
    ChangedPageVisibility: ({ visibility }) => pageVisibilityInRun(visibility),
    ClickedPauseButton: () => unchanged,
    ClickedStartWaveButton: () => pressInRun(SeatAction.Ready()),
    ClickedSwapButton: () => pressInRun(SeatAction.Swap()),
    ClickedGunSlot: ({ slot }) =>
      pressInRun(gunSlotAction(focusOf(model).player, slot)),
    ClickedMeleeSlot: () => pressInRun(SeatAction.Melee()),
    ClickedReloadButton: () => pressInRun(SeatAction.Reload()),
    ClickedPlaceTrapButton: () => pressInRun(SeatAction.PlaceTrap()),
    ClickedNextTrapButton: () => pressInRun(SeatAction.NextTrap()),
    ClickedMedicButton: () => pressInRun(SeatAction.CallMedic()),
  })

export const orInRun: {
  (offline: UpdateStep): (message: RunMessage) => UpdateStep
  (message: RunMessage, offline: UpdateStep): UpdateStep
} = Function.dual(
  2,
  (message: RunMessage, offline: UpdateStep): UpdateStep =>
    $ =>
      isRunOn($.model) ? inRun($.model, message)($) : offline($),
)
