import { Effect, Option, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'
import { HtmlCommand } from '@effect/ui/html'

import { callingOfMember } from '../../art/seatLooks'
import { LobbyChange, isInLobby, maybeRoomOf } from '../../domain/coopRoom'
import type { Calling } from '../../shared/playerData'
import {
  type CallingStanding,
  callingPriceOf,
  callingStandingOf,
  isCallingOwned,
} from '../../world/heroes/calling'
import { makeEdits } from './lobbyEdits'
import { CoopNotice } from './message'
import { type Model } from './model'
import { CoopNet } from './net'
import {
  CALLING_PILL,
  CODE_INPUT,
  type CoopFocus,
  NAME_BUTTON,
  NAME_INPUT,
  QUICK_PLAY_BUTTON,
  READY_BUTTON,
  meIn,
} from './roomState'

// Co-op's rules that its update (src/features/coop/update.ts) and the
// root's hero picker events share, with the two Commands they return:
// focusing an element, and changing the room's lobby. Each rule is pure over
// co-op's own Model and returns a `CoopResultOf`: the next Model, the
// Commands to run, and a notice for the root (src/app/update/coop.ts).

// RESULT

export type CoopResultOf<C> = Readonly<{
  model: Model
  commands?: ReadonlyArray<C>
  notice?: CoopNotice
}>

// COMMANDS

const noFocusNews = () => Component.noop

const FOCUS = {
  QuickPlay: () => HtmlCommand.focus(QUICK_PLAY_BUTTON, noFocusNews),
  Code: () => HtmlCommand.focus(CODE_INPUT, noFocusNews),
  Ready: () => HtmlCommand.focus(READY_BUTTON, noFocusNews),
  CallingPill: () => HtmlCommand.focus(CALLING_PILL, noFocusNews),
  NameButton: () => HtmlCommand.focus(NAME_BUTTON, noFocusNews),
  NameInput: () => HtmlCommand.focus(NAME_INPUT, noFocusNews),
} satisfies Record<CoopFocus, unknown>

export const focusCoop = (target: CoopFocus) => FOCUS[target]()

// NOTE: a lobby change goes to the room; the room's next lobby frame shows
// it. A refused one changes nothing on screen, so it is logged.
export class ChangeLobby extends Command.Service<ChangeLobby>()(
  'coop/ChangeLobby',
  { args: { change: LobbyChange }, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return ({ change }) =>
        net.changeLobby(change).pipe(
          Effect.catch(problem =>
            Effect.logWarning('change the co-op lobby', problem),
          ),
          Effect.as(Component.noop),
        )
    }),
  )
}

export type LobbyCommand =
  | ReturnType<typeof ChangeLobby.make>
  | ReturnType<typeof focusCoop>

type LobbyResult = CoopResultOf<LobbyCommand>

export const edits = makeEdits<LobbyCommand>({
  changeLobby: change => ChangeLobby.make({ change }),
  focus: target => focusCoop(target),
})

// THE HERO PICKER

// NOTE: you in the room's lobby while it still waits: the hero picker
// opens only then, and closes when the room moves on.
export const lobbyMeOf = (model: Model) =>
  pipe(maybeRoomOf(model), Option.filter(isInLobby), Option.flatMap(meIn))

const isHeroPickOpen = (model: Model): boolean => model.heroPick.isOpen

// NOTE: opening or closing the picker ends any try-on.
const withPickerOpen = (model: Model, isOpen: boolean): Model =>
  UiStruct.evolve(model, {
    heroPick: () => ({ isOpen, maybeTrying: Option.none() }),
  })

const withTrying = (model: Model, maybeTrying: Option.Option<Calling>): Model =>
  UiStruct.evolve(model, {
    heroPick: heroPick => ({ ...heroPick, maybeTrying }),
  })

export const closePicker = (model: Model): LobbyResult => ({
  model: withPickerOpen(model, false),
})

// NOTE: the hero is the player's: sent to the room's lobby for the others to
// see and to seat at the start, and the picker closes on the pill. Nobody's
// READY changes.
const wear = (model: Model, calling: Calling): LobbyResult => ({
  model: withPickerOpen(
    UiStruct.evolve(model, { calling: () => calling }),
    false,
  ),
  commands: [
    ChangeLobby.make({
      change: LobbyChange.ChangedMemberCalling({ calling }),
    }),
    focusCoop('CallingPill'),
  ],
})

// NOTE: the pill opens the picker, and closes it again.
export const togglePicker = (model: Model): LobbyResult =>
  Option.isNone(lobbyMeOf(model))
    ? { model }
    : { model: withPickerOpen(model, !isHeroPickOpen(model)) }

// NOTE: a card in the picker. One the player owns is worn, and goes up to
// the root, which saves it as the player's pick at home too; the one already
// worn only closes the picker. One for sale (the rank reached, not bought)
// is tried on, as in the solo lobby's picker, and its BUY pill asks the root
// to spend the Bones. One below the rank stays shut.
const CARD_TAPS = {
  Owned: (model: Model, calling: Calling, isWorn: boolean): LobbyResult =>
    isWorn
      ? {
          model: withPickerOpen(model, false),
          commands: [focusCoop('CallingPill')],
        }
      : {
          ...wear(model, calling),
          notice: CoopNotice.ChoseCalling({ calling }),
        },
  ForSale: (model: Model, calling: Calling): LobbyResult => ({
    model: withTrying(model, Option.some(calling)),
  }),
  Locked: (model: Model): LobbyResult => ({ model }),
} satisfies Record<CallingStanding, unknown>

export const pickHero =
  (calling: Calling) =>
  (model: Model): LobbyResult =>
    Option.match(
      Option.filter(lobbyMeOf(model), () => isHeroPickOpen(model)),
      {
        onNone: () => ({ model }),
        onSome: me =>
          CARD_TAPS[callingStandingOf(calling, me.rank, model.bought)](
            model,
            calling,
            callingOfMember(me) === calling,
          ),
      },
    )

// NOTE: the BUY pill, for the hero being tried on while it is still for sale
// and the Bones cover it. The root spends them and hands the purse back
// through `boughtHero`, which makes the hero the pick; nothing is spent here.
export const buyHero =
  (calling: Calling) =>
  (model: Model): LobbyResult =>
    isHeroPickOpen(model) &&
    Option.exists(
      lobbyMeOf(model),
      me =>
        callingStandingOf(calling, me.rank, model.bought) === 'ForSale' &&
        model.bones >= Option.getOrElse(callingPriceOf(calling), () => 0),
    )
      ? {
          model: withTrying(model, Option.none()),
          notice: CoopNotice.BoughtCalling({ calling }),
        }
      : { model }

// NOTE: the root bought the hero: the purse is updated, and the hero is the
// player's pick, sent to the room like any other pick. The root has saved it
// already, so no ChoseCalling goes up.
export const boughtHero =
  (
    bought: Readonly<{
      calling: Calling
      bought: Model['bought']
      bones: number
    }>,
  ) =>
  (model: Model): LobbyResult => {
    const paid = UiStruct.evolve(model, {
      bought: () => bought.bought,
      bones: () => bought.bones,
    })
    return Option.isSome(lobbyMeOf(paid)) &&
      isCallingOwned(bought.calling, bought.bought)
      ? wear(paid, bought.calling)
      : { model: paid }
  }

// NOTE: the picker is the lobby's: once the room starts its run, or is left,
// an open picker closes, so it never waits over the next lobby.
export const closeStrayPicker = (model: Model): Model =>
  isHeroPickOpen(model) && Option.isNone(lobbyMeOf(model))
    ? withPickerOpen(model, false)
    : model
