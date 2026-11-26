import { Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'

import { Bot, HomeMode } from '../../domain/clientSchema'
import {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '../../shared/playerData'
import { Modifiers } from '../../world/run/modifiers'
import { DifficultySetting } from '../../world/schema/worldSchema'

// NOTE: every control the lobby's arrow keys walk, in order: BACK, the hero
// card, each crew seat (a + BOT tile, or a bot's hero card with its x), the
// two modes, the four difficulties, the dare ladder's mark (once one is
// opened), Dare's break clock (on Dare alone), the modifiers, then START.
export const LobbyControl = Schema.Literals([
  'Back',
  'Hero',
  'Bot1',
  'Drop1',
  'Bot2',
  'Drop2',
  'Bot3',
  'Drop3',
  'Campaign',
  'Endless',
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
  'Mark',
  'EasyBreak',
  'FriendlyFire',
  'BigCrowd',
  'Broke',
  'Glass',
  'Start',
])
export type LobbyControl = typeof LobbyControl.Type

// NOTE: what a run is picked from, as the root keeps it: the mode, the
// difficulty (with whether Nightmare is open, for its padlock and NEW pip),
// the dare ladder's mark with the best opened on that difficulty,
// Dare's break clock, the run modifiers, and the teammate bots, with how many bots fit (a dev
// link's couch players take seats). The root hands it to the lobby as its
// props, and the lobby tells the root each pick (its events): the root saves the difficulty and a run reads them all.
// A friend's dare taken from the home menu (src/domain/beatMyRun.ts) holds
// them all to its link's (`lock`), with no bots.
const PicksLock = Schema.Literals(['Open', 'FriendsDare'])

export const LobbyPicks = Schema.Struct({
  mode: HomeMode,
  difficulty: DifficultySetting,
  modifiers: Modifiers,
  easyBreakSeconds: Schema.Finite,
  dareMark: Schema.Finite,
  bestMark: Schema.Finite,
  bots: Schema.Array(Bot),
  botSeats: Schema.Finite,
  lock: PicksLock,
})
export type LobbyPicks = typeof LobbyPicks.Type

// NOTE: where the dare card stands. It unfolds out of PLAY as it opens
// (Open), and CHICKEN OUT folds it back into PLAY: Folding while the fold
// plays, with the card drawn but dead to taps and keys and the home menu
// already back in charge, then Closed. A run that starts or a way home
// leaves it Closed at once.
export const LobbyStatus = Schema.Literals(['Closed', 'Open', 'Folding'])
export type LobbyStatus = typeof LobbyStatus.Type

// NOTE: the lobby as the root keeps it (Effect UI, "Who owns the state":
// menuState, the root's keys, and the root's tests read all of it): where
// the card stands, the control in focus (where the arrow keys step from),
// whether the hero picker's Dialog is up, the bot whose hero it chooses (an
// index into the picks' bots), and the hero for sale being tried on (its
// BUY pill buys it). The Lobby component draws it from props.
export const LobbyState = Schema.Struct({
  status: LobbyStatus,
  maybeFocus: Schema.Option(LobbyControl),
  isHeroPickerOpen: Schema.Boolean,
  maybePickingBot: Schema.Option(Schema.Finite),
  maybeTrying: Schema.Option(Calling),
})
export type LobbyState = typeof LobbyState.Type

// NOTE: the lobby as a game starts, closed.
export const initialLobby: LobbyState = {
  status: 'Closed',
  maybeFocus: Option.none(),
  isHeroPickerOpen: false,
  maybePickingBot: Option.none(),
  maybeTrying: Option.none(),
}

// NOTE: reads for the root: whether the lobby is up (whatever is over it),
// whether it is drawn at all (up, or folding back into PLAY), whether its
// hero picker is up, and whether the lobby itself takes taps and keys (up
// with nothing over it).
export const isLobbyShown = (lobby: LobbyState): boolean =>
  lobby.status === 'Open'

export const isLobbyDrawn = (lobby: LobbyState): boolean =>
  lobby.status !== 'Closed'

export const isHeroPickerUp = (lobby: LobbyState): boolean =>
  isLobbyShown(lobby) && lobby.isHeroPickerOpen

export const isLobbyActive = (lobby: LobbyState): boolean =>
  isLobbyShown(lobby) && !lobby.isHeroPickerOpen

// TRANSITIONS

// NOTE: the lobby opens with no control in focus and no picker up (the root
// then focuses START, so Enter plays at once).
export const openedLobby = (lobby: LobbyState): LobbyState =>
  UiStruct.evolve(lobby, {
    status: () => 'Open',
    maybeFocus: () => Option.none(),
    isHeroPickerOpen: () => false,
    maybePickingBot: () => Option.none(),
    maybeTrying: () => Option.none(),
  })

export const withLobbyFocus =
  (maybeFocus: Option.Option<LobbyControl>) =>
  (lobby: LobbyState): LobbyState =>
    UiStruct.evolve(lobby, { maybeFocus: () => maybeFocus })

export const withLobbyStatus =
  (status: LobbyStatus) =>
  (lobby: LobbyState): LobbyState =>
    UiStruct.evolve(lobby, {
      status: () => status,
      maybeFocus: () => Option.none(),
    })

// NOTE: the fold back into PLAY is over; a lobby opened again before then
// stays Open.
export const finishedFold = (lobby: LobbyState): LobbyState =>
  lobby.status === 'Folding' ? withLobbyStatus('Closed')(lobby) : lobby

export const withoutPickingBot = (lobby: LobbyState): LobbyState =>
  UiStruct.evolve(lobby, { maybePickingBot: () => Option.none() })

// NOTE: the hero card opens the picker for the player, a bot's card for
// that bot, with nothing tried on.
export const openedHeroPicker =
  (maybeBot: Option.Option<number>) =>
  (lobby: LobbyState): LobbyState =>
    UiStruct.evolve(lobby, {
      isHeroPickerOpen: () => true,
      maybePickingBot: () => maybeBot,
      maybeTrying: () => Option.none(),
    })

// NOTE: the picker closed (Escape, the backdrop, its close button, or a
// hero worn): the next opening chooses for the player.
export const closedHeroPicker = (lobby: LobbyState): LobbyState =>
  UiStruct.evolve(lobby, {
    isHeroPickerOpen: () => false,
    maybePickingBot: () => Option.none(),
    maybeTrying: () => Option.none(),
  })

export const withTrying =
  (maybeTrying: Option.Option<Calling>) =>
  (lobby: LobbyState): LobbyState =>
    UiStruct.evolve(lobby, { maybeTrying: () => maybeTrying })

// PROPS

// NOTE: what the root hands the Lobby component: the lobby's state and the
// picks (both the root's), the player's name, look, rank, and hero (with
// whether a new one waits), the heroes bought and the Bones (for the
// picker's cards and BUY), the unlocks that wear a NEW badge, and whether
// a keyboard is in hand (the key caps).
export const LobbyProps = Schema.Struct({
  lobby: LobbyState,
  picks: LobbyPicks,
  name: Schema.String,
  look: Appearance,
  rank: Schema.Finite,
  calling: Calling,
  isHeroNew: Schema.Boolean,
  bought: SavedBoughtCosmetics,
  bones: Schema.Finite,
  fresh: Schema.Array(Schema.String),
  isKeyboard: Schema.Boolean,
})
export type LobbyProps = typeof LobbyProps.Type
