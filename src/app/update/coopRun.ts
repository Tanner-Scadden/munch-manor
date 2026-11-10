import { Function, Option, Result, Schema } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { isRunOn } from '../../domain/onlineRun'
import { isPauseKey, pressKey, releaseAll } from '../../input/input'
import { playerKeyAction } from '../../input/keyActions'
import type { PageVisibility } from '../../platform/deviceSchema'
import { focusOf, focusSlotOf } from '../../world/party/party'
import { isArriving } from '../../world/run/arrival'
import { maybeTapOffer } from '../../world/shop/purchase'
import { isAtCounter } from '../../world/shop/shop'
import {
  SeatAction,
  gunSlotAction,
  trySeatAction,
} from '../../world/step/stepWorld'
import { makeStep } from '../definition'
import { Message } from '../message'
import type { Model, ShopItemId } from '../model'
import { pressInRoom } from './coop'
import { skipIntro } from './intro'
import { playSounds, toggleAudioFromKey, uiCue, unlockAudio } from './sound'
import { type UpdateStep, modelStep, unchanged, withInput } from './step'

// The Messages an online co-op run handles its own way (MULTIPLAYER.md,
// Phase 2). The room runs the World, so nothing here steps it: a press
// (swap, the knife, reload, a trap, READY, a buy, leaving the counter) goes
// to the room as a seat action, the frame comes from the room, and there
// is no pause (decided 7). Everything else (moving, aiming, the dialogs,
// the menus, audio, the save) runs as it does in single player. Each
// of these handlers (src/app/update/input.ts, and the frame's in
// src/app/main.ts) wraps its single player Step in
// `orInRun`, which checks isRunOn once and matches the Message; the shop's
// buy, an OutMessage, goes through `orBuyInRun`.

const pressInRun = (action: SeatAction) =>
  makeStep(() => Update.combineSteps([unlockAudio, pressInRoom(action)]))

// NOTE: a buy the room would refuse sounds refused at once; one it would
// take rings up at once, and the room's wallet follows. The client asks the
// same rule the room runs, on its own seat.
const buyInRun = (item: ShopItemId) =>
  makeStep(model =>
    Update.combineSteps([
      pressInRun(SeatAction.Buy({ item })),
      playSounds([
        uiCue(
          Result.isSuccess(
            trySeatAction(model, focusSlotOf(model), SeatAction.Buy({ item })),
          )
            ? 'Purchase'
            : 'Denied',
        ),
      ]),
    ]),
  )

const holdKey =
  (code: string): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(toggleAudioFromKey(stepModel, code), {
        lastDevice: () => 'KeyboardMouse',
      }),
      input => (isPauseKey(code) ? input : pressKey(input, code)),
    ),
  })

// NOTE: at the counter the dialog has the keys; in the fight a press key
// goes to the room, and every key is held in the input for walking. In the
// intro any key skips this player's drawing to the door
// (src/app/update/intro.ts).
const keyInRun = (code: string) =>
  makeStep(model =>
    isArriving(model.phase)
      ? Update.combineSteps([holdKey(code), modelStep(skipIntro), unlockAudio])
      : isAtCounter(focusOf(model).shop)
        ? Update.combineSteps([holdKey(code), unlockAudio])
        : Option.match(playerKeyAction(model, code), {
            onNone: () => Update.combineSteps([holdKey(code), unlockAudio]),
            onSome: action =>
              Update.combineSteps([holdKey(code), pressInRun(action)]),
          }),
  )

// NOTE: a tap at the ammo window goes to the room as BuyAmmo, which buys
// there at once (src/world/shop/purchase.ts); the room's tick makes its sound.
const tapInRun = makeStep(model =>
  Option.isSome(maybeTapOffer(model, focusSlotOf(model)))
    ? pressInRun(SeatAction.BuyAmmo())
    : unchanged,
)

const blurInRun = modelStep(model => withInput(model, releaseAll))

const pageVisibilityInRun = (visibility: PageVisibility) =>
  modelStep(model =>
    withInput(
      modifyFields(model, { pageVisibility: () => visibility }),
      releaseAll,
    ),
  )

// THE RUN'S MESSAGES

const RunMessage = Schema.Union([
  Message.TickedFrame,
  Message.PressedKey,
  Message.BlurredWindow,
  Message.ChangedPageVisibility,
  Message.ClickedPauseButton,
  Message.ClickedStartWaveButton,
  Message.ClickedSwapButton,
  Message.ClickedGunSlot,
  Message.ClickedMeleeSlot,
  Message.ClickedReloadButton,
  Message.ClickedPlaceTrapButton,
  Message.ClickedNextTrapButton,
  Message.PressedHoldButton,
  Message.ClickedAmmoTag,
  Message.ClickedMedicButton,
])
type RunMessage = typeof RunMessage.Type

// NOTE: Message.match, exhaustive over just these Messages. Effect's
// Match would unify the Steps' types and drop the Binding evidence
// makeStep needs.
const inRun = (model: Model, message: RunMessage) =>
  Message.match(message, {
    TickedFrame: () => unchanged,
    PressedKey: ({ code }) => keyInRun(code),
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
    PressedHoldButton: () => tapInRun,
    ClickedAmmoTag: () => tapInRun,
    ClickedMedicButton: () => pressInRun(SeatAction.CallMedic()),
  })

// NOTE: the Message's Step in an online run, or the single player Step
// given here. A handler hands it to `makeStep` itself, so the Step's
// Binding evidence comes from its own single player Step:
// `makeStep(orInRun(message, swapFromButton))`.
export const orInRun: {
  <Offline>(
    message: RunMessage,
    offline: Offline,
  ): (model: Model) => ReturnType<typeof inRun> | Offline
  <Offline>(
    model: Model,
    message: RunMessage,
    offline: Offline,
  ): ReturnType<typeof inRun> | Offline
} = Function.dual(
  3,
  <Offline>(
    model: Model,
    message: RunMessage,
    offline: Offline,
  ): ReturnType<typeof inRun> | Offline =>
    isRunOn(model) ? inRun(model, message) : offline,
)

// NOTE: a row picked in the shop dialog is no root Message but the shop's
// PickedItem (src/app/composition.ts): its buy in an online run, or the
// single player Step given here, as `orInRun` does for a Message.
export const orBuyInRun: {
  <Offline>(
    item: ShopItemId,
    offline: Offline,
  ): (model: Model) => ReturnType<typeof buyInRun> | Offline
  <Offline>(
    model: Model,
    item: ShopItemId,
    offline: Offline,
  ): ReturnType<typeof buyInRun> | Offline
} = Function.dual(
  3,
  <Offline>(
    model: Model,
    item: ShopItemId,
    offline: Offline,
  ): ReturnType<typeof buyInRun> | Offline =>
    isRunOn(model) ? buyInRun(item) : offline,
)
