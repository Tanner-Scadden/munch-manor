import { Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'

import { Bot, HomeMode } from '#domain/clientSchema.ts'
import {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '#shared/records/playerData.ts'
import { Modifiers } from '#world/run/modifiers.ts'
import { DifficultySetting } from '#world/schema/worldSchema.ts'

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

export const LobbyStatus = Schema.Literals(['Closed', 'Open', 'Folding'])
export type LobbyStatus = typeof LobbyStatus.Type

export const LobbyState = Schema.Struct({
  status: LobbyStatus,
  maybeFocus: Schema.Option(LobbyControl),
  isHeroPickerOpen: Schema.Boolean,
  maybePickingBot: Schema.Option(Schema.Finite),
  maybeTrying: Schema.Option(Calling),
})
export type LobbyState = typeof LobbyState.Type

export const initialLobby: LobbyState = {
  status: 'Closed',
  maybeFocus: Option.none(),
  isHeroPickerOpen: false,
  maybePickingBot: Option.none(),
  maybeTrying: Option.none(),
}

export const isLobbyShown = (lobby: LobbyState): boolean =>
  lobby.status === 'Open'

export const isLobbyDrawn = (lobby: LobbyState): boolean =>
  lobby.status !== 'Closed'

export const isHeroPickerUp = (lobby: LobbyState): boolean =>
  isLobbyShown(lobby) && lobby.isHeroPickerOpen

export const isLobbyActive = (lobby: LobbyState): boolean =>
  isLobbyShown(lobby) && !lobby.isHeroPickerOpen

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

export const finishedFold = (lobby: LobbyState): LobbyState =>
  lobby.status === 'Folding' ? withLobbyStatus('Closed')(lobby) : lobby

export const withoutPickingBot = (lobby: LobbyState): LobbyState =>
  UiStruct.evolve(lobby, { maybePickingBot: () => Option.none() })

export const openedHeroPicker =
  (maybeBot: Option.Option<number>) =>
  (lobby: LobbyState): LobbyState =>
    UiStruct.evolve(lobby, {
      isHeroPickerOpen: () => true,
      maybePickingBot: () => maybeBot,
      maybeTrying: () => Option.none(),
    })

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
