import { Option, Result } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { makeStep } from '../definition'
import { isPauseKey, pressKey, releaseAll } from '../input'
import { playerKeyAction } from '../keyActions'
import { Message } from '../message'
import { type Model, type PageVisibility, type ShopItemId } from '../model'
import { isRunOn } from '../onlineRun'
import { maybeTapOffer } from '../purchase'
import { isAtCounter } from '../shop'
import { SeatAction, gunSlotAction, trySeatAction } from '../stepWorld'
import { pressInRoom } from './coop'
import { playSounds, toggleAudioFromKey, uiCue, unlockAudio } from './sound'
import { type UpdateStep, modelStep, unchanged, withInput } from './step'

// The Messages an online co-op run handles its own way (MULTIPLAYER.md,
// Phase 2). The room runs the World, so nothing here steps it: a press
// (swap, the knife, reload, a trap, READY, a buy, leaving the counter) goes
// to the room as a seat action, the frame comes from the room, and there
// is no pause (decided 7). Everything else (moving, aiming, the dialogs,
// the menus, audio, the save) runs as it does in single player. Each
// of these handlers in src/main.ts wraps its single player Step in
// `orInRun`, which checks isRunOn once and matches the Message.

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
          Result.isSuccess(trySeatAction(model, SeatAction.Buy({ item })))
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
// goes to the room, and every key is held in the input for walking.
const keyInRun = (code: string) =>
  makeStep(model =>
    isAtCounter(model.shop)
      ? Update.combineSteps([holdKey(code), unlockAudio])
      : Option.match(playerKeyAction(model, code), {
          onNone: () => Update.combineSteps([holdKey(code), unlockAudio]),
          onSome: action =>
            Update.combineSteps([holdKey(code), pressInRun(action)]),
        }),
  )

// NOTE: a tap at the ammo window goes to the room as BuyAmmo, which buys
// there at once (src/purchase.ts); the room's tick makes its sound.
const tapInRun = makeStep(model =>
  Option.isSome(maybeTapOffer(model))
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

type RunMessage =
  | typeof Message.TickedFrame.Type
  | typeof Message.PressedKey.Type
  | typeof Message.BlurredWindow.Type
  | typeof Message.ChangedPageVisibility.Type
  | typeof Message.ClickedPauseButton.Type
  | typeof Message.ClickedStartWaveButton.Type
  | typeof Message.ClickedSwapButton.Type
  | typeof Message.ClickedGunSlot.Type
  | typeof Message.ClickedMeleeSlot.Type
  | typeof Message.ClickedReloadButton.Type
  | typeof Message.ClickedPlaceTrapButton.Type
  | typeof Message.ClickedNextTrapButton.Type
  | typeof Message.ClickedBuyButton.Type
  | typeof Message.PressedBuyKey.Type
  | typeof Message.PressedHoldButton.Type
  | typeof Message.ClickedAmmoTag.Type

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
    ClickedGunSlot: ({ slot }) => pressInRun(gunSlotAction(model.player, slot)),
    ClickedMeleeSlot: () => pressInRun(SeatAction.Melee()),
    ClickedReloadButton: () => pressInRun(SeatAction.Reload()),
    ClickedPlaceTrapButton: () => pressInRun(SeatAction.PlaceTrap()),
    ClickedNextTrapButton: () => pressInRun(SeatAction.NextTrap()),
    ClickedBuyButton: ({ item }) => buyInRun(item),
    PressedBuyKey: ({ item }) => buyInRun(item),
    PressedHoldButton: () => tapInRun,
    ClickedAmmoTag: () => tapInRun,
  })

// NOTE: the Message's Step in an online run, or the single player Step
// given here. A handler hands it to `makeStep` itself, so the Step's
// Binding evidence comes from its own single player Step:
// `makeStep(orInRun(message, swapFromButton))`.
export const orInRun =
  <Offline>(message: RunMessage, offline: Offline) =>
  (model: Model): ReturnType<typeof inRun> | Offline =>
    isRunOn(model) ? inRun(model, message) : offline
