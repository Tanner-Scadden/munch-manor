import { Effect, Option, Schema, pipe } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { Calling } from '../../shared/playerData'
import {
  type CallingStanding,
  callingPriceOf,
  callingStandingOf,
  isCallingOwned,
} from '../../world/heroes/calling'
import { PickOutcome } from '../heroes/inMessage'
import { isPickerOpen } from '../heroes/model'
import { HeroPickerBinding } from './bindings'
import { CoopBlock, makeNoopStep, makeStep } from './block'
import { makeEdits } from './lobbyEdits'
import { callingOfMember } from './looks'
import { Message, OutMessage } from './message'
import { LobbyChange, type Model } from './model'
import { CoopNet } from './net'
import { CALLING_PILL_ID, isInLobby, maybeRoomOf, meIn } from './roomState'

// Co-op's Steps that its update, its InMessages, and the hero picker's fold
// share (FOLDKIT.md, "File organization"), with the two Commands they
// return: focusing an element, and changing the room's lobby.

// COMMANDS

export const FocusCoopElement = CoopBlock.makeCommand('FocusCoopElement', {
  args: { id: Schema.String },
  messages: [Message.CompletedFocusCoopElement],
  handler: function* () {
    return ({ id }) =>
      Dom.focus(`#${id}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusCoopElement()),
      )
  },
})

export const ChangeLobby = CoopBlock.makeCommand('ChangeLobby', {
  args: { change: LobbyChange },
  messages: [Message.CompletedChangeLobby, Message.FailedChangeLobby],
  handler: function* () {
    return ({ change }) =>
      CoopNet.use(net => net.changeLobby(change)).pipe(
        Effect.as(Message.CompletedChangeLobby()),
        Effect.catch(problem =>
          Effect.succeed(Message.FailedChangeLobby({ problem })),
        ),
      )
  },
})

export const edits = makeEdits<
  ReturnType<typeof ChangeLobby> | ReturnType<typeof FocusCoopElement>
>({
  changeLobby: change => ChangeLobby({ change }),
  focus: id => FocusCoopElement({ id }),
})

// THE HERO PICKER

// NOTE: you in the room's lobby while it still waits: the hero picker
// opens only then, and closes when the room moves on.
export const lobbyMeOf = (model: Model) =>
  pipe(maybeRoomOf(model), Option.filter(isInLobby), Option.flatMap(meIn))

const answer = (outcome: PickOutcome) =>
  HeroPickerBinding.informOfOutcome({ outcome })

const focusPill = (model: Model) => ({
  model,
  commands: [FocusCoopElement({ id: CALLING_PILL_ID })],
})

// NOTE: co-op's Model as a Binding's operation runs on it, inside a handler
// or a fold: a Step that adds an OutMessage to an operation's result takes
// this one, as `makeStep`'s Model cannot run an operation.
type Connected = Parameters<ReturnType<typeof HeroPickerBinding.requestOpen>>[0]

// NOTE: the hero is the player's: sent to the room's lobby for the others to
// see and to seat at the start, and the picker closes on the pill. Nobody's
// READY changes.
const wornLocally = (calling: Calling) => (model: Model) => ({
  model: modifyFields(model, { calling: () => calling }),
  commands: [
    ChangeLobby({ change: LobbyChange.ChangedMemberCalling({ calling }) }),
    FocusCoopElement({ id: CALLING_PILL_ID }),
  ],
})

const wear = (calling: Calling) =>
  Update.combineSteps([
    wornLocally(calling),
    answer(PickOutcome.Worn({ calling })),
  ])

// NOTE: the pill opens the picker, and closes it again.
export const togglePicker = makeStep(model => {
  if (Option.isNone(lobbyMeOf(model))) {
    return makeNoopStep()
  } else if (isPickerOpen(model.heroPicker)) {
    return HeroPickerBinding.requestClose()
  } else {
    return HeroPickerBinding.requestOpen()
  }
})

// NOTE: a card in the picker. One the player owns is worn, and goes up to
// the parent, which saves it as the player's pick at home too; the one
// already worn only closes the picker. One for sale (the rank reached, not
// bought) is tried on, as in the solo lobby's picker, and its BUY pill asks
// the parent to spend the Bones. One below the rank stays shut.
const CARD_TAPS = {
  Owned: (model: Connected, calling: Calling, isWorn: boolean) =>
    isWorn
      ? Update.combineSteps(model, [
          focusPill,
          answer(PickOutcome.Worn({ calling })),
        ])
      : pipe(
          wear(calling)(model),
          Update.withOutMessage(OutMessage.ChoseCalling({ calling })),
        ),
  ForSale: (model: Connected, calling: Calling) =>
    answer(PickOutcome.TriedOn({ calling }))(model),
  Locked: (model: Connected) => makeNoopStep()(model),
} satisfies Record<CallingStanding, unknown>

export const pickHero = (calling: Calling) => (model: Connected) =>
  Option.match(lobbyMeOf(model), {
    onNone: () => makeNoopStep()(model),
    onSome: me =>
      CARD_TAPS[callingStandingOf(calling, me.rank, model.bought)](
        model,
        calling,
        callingOfMember(me) === calling,
      ),
  })

// NOTE: the BUY pill, for the hero being tried on while it is still for sale
// and the Bones cover it. The parent spends them and answers with
// `RequestedBoughtHero`, which makes the hero the pick; nothing is spent here.
export const buyHero = (calling: Calling) => (model: Connected) =>
  Option.exists(
    lobbyMeOf(model),
    me =>
      callingStandingOf(calling, me.rank, model.bought) === 'ForSale' &&
      model.bones >= Option.getOrElse(callingPriceOf(calling), () => 0),
  )
    ? pipe(
        answer(PickOutcome.TryOnEnded())(model),
        Update.withOutMessage(OutMessage.BoughtCalling({ calling })),
      )
    : makeNoopStep()(model)

// NOTE: the parent bought the hero: the purse is updated, and the hero is
// the player's pick, sent to the room like any other pick. The parent has
// saved it already, so no ChoseCalling goes up.
export const boughtHero = ({
  calling,
  bought,
  bones,
}: Readonly<{
  calling: Calling
  bought: Model['bought']
  bones: number
}>) =>
  Update.combineSteps([
    (model: Model) => ({
      model: modifyFields(model, {
        bought: () => bought,
        bones: () => bones,
      }),
    }),
    makeStep(model =>
      Option.isSome(lobbyMeOf(model)) && isCallingOwned(calling, bought)
        ? wear(calling)
        : makeNoopStep(),
    ),
  ])

// NOTE: the picker is the lobby's: once the room starts its run, or is left,
// an open picker closes, so it never waits over the next lobby.
export const closeStrayPicker = makeStep(model =>
  isPickerOpen(model.heroPicker) && Option.isNone(lobbyMeOf(model))
    ? HeroPickerBinding.requestClose()
    : makeNoopStep(),
)
