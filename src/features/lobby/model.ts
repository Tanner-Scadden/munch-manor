import { Option, Schema } from 'effect'

import { DialogBlock } from '@foldkit/ui'

import { Bot, HomeMode } from '../../app/clientSchema'
import { Modifiers } from '../../world/run/modifiers'
import { DifficultySetting } from '../../world/schema/worldSchema'
import { HeroPickerBlock } from '../heroes/block'
import { OpenStatus, isPickerOpen } from '../heroes/model'

// NOTE: every control the lobby's arrow keys walk, in order: BACK, the hero
// card, each crew seat (a + BOT tile, or a bot's hero card with its x), the
// two modes, the four difficulties, the modifiers, then START.
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
  'FriendlyFire',
  'BigCrowd',
  'Broke',
  'Glass',
  'Start',
])
export type LobbyControl = typeof LobbyControl.Type

// NOTE: what a run is picked from, as the root keeps it: the mode, the
// difficulty (with whether Nightmare is open, for its padlock and NEW pip),
// the run modifiers, and the teammate bots, with how many bots fit (a dev
// link's couch players take seats). The root hands it to the lobby as its
// update context and view input, and the lobby tells the root each pick
// (its OutMessages): the root saves the difficulty and a run reads them all.
export const LobbyPicks = Schema.Struct({
  mode: HomeMode,
  difficulty: DifficultySetting,
  modifiers: Modifiers,
  bots: Schema.Array(Bot),
  botSeats: Schema.Finite,
})
export type LobbyPicks = typeof LobbyPicks.Type

// NOTE: the lobby's own state: up or not (a screen of the home menu, so a
// run that starts or a way home leaves it Closed), the control in focus (where the
// arrow keys step from), and the bot whose hero the open picker chooses (an
// index into the picks' bots). The hero picker and the Dialog it stands in
// are its children, on `heroPicker` and `heroDialog`.
export const Model = Schema.Struct({
  status: OpenStatus,
  maybeFocus: Schema.Option(LobbyControl),
  maybePickingBot: Schema.Option(Schema.Finite),
  heroPicker: HeroPickerBlock.Model,
  heroDialog: DialogBlock.Model,
})
export type Model = typeof Model.Type

// NOTE: the lobby's own fields as it starts, closed.
export const initialModel: Omit<Model, 'heroPicker' | 'heroDialog'> = {
  status: 'Closed',
  maybeFocus: Option.none(),
  maybePickingBot: Option.none(),
}

// NOTE: reads for the root, so it never reads the lobby's fields: whether
// the lobby is on screen (whatever is over it), and whether its hero
// picker is up.
export const isLobbyShown = (model: Model): boolean => model.status === 'Open'

export const isHeroPickerUp = (model: Model): boolean =>
  isLobbyShown(model) &&
  (model.heroDialog.isOpen || isPickerOpen(model.heroPicker))
