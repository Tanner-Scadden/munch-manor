import { Function, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { isOpen as isCoopScreenOpen } from '../features/coop/update'
import { MenuPanel } from '../features/home/homeSchema'
import { isHeroPickerUp, isLobbyShown } from '../features/lobby/model'
import { ProfileTab } from '../features/profile/model'
import { tabOf } from '../features/profile/profile'
import { RESTART_GRACE_MS } from '../shared/constants'
import { type Model, Phase } from './model'

// NOTE: what the player is looking at, derived from the Model and never
// stored. Update's gates and the view both read it, so "is a menu open"
// has one answer. The dialogs come first, top to bottom, then the hero
// picker over the single player lobby, the lobby, co-op's own screens, and the phase. Only this module reads a dialog's `isOpen` or `model.coop.screen`
// (munch/no-menu-field).
export const MenuState = defineTaggedUnion({
  Profile: { tab: ProfileTab },
  Panel: { panel: MenuPanel },
  Hand: {},
  InstallSteps: {},
  UpdateGreeting: {},
  HeroPicker: {},
  Lobby: {},
  Coop: {},
  Home: {},
  Playing: {},
  Paused: {},
  EndScreen: { isPastGrace: Schema.Boolean },
})
export type MenuState = typeof MenuState.Type

// NOTE: an end screen ignores taps and keys for a moment, so a shot fired
// as the run ends does not press a button.
export const isPastRestartGrace = (model: Model): boolean =>
  model.screenMs >= RESTART_GRACE_MS

const phaseState = (model: Model): MenuState =>
  Phase.match(model.phase, {
    Ready: () => MenuState.Home(),
    Preparation: () => MenuState.Playing(),
    Wave: () => MenuState.Playing(),
    Paused: () => MenuState.Paused(),
    Escaped: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
    GameOver: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
  })

export const menuState = (model: Model): MenuState => {
  if (model.profileDialog.isOpen) {
    return MenuState.Profile({ tab: tabOf(model.profile) })
  } else if (model.panelDialog.isOpen) {
    return MenuState.Panel({ panel: model.panel })
  } else if (model.handDialog.isOpen) {
    return MenuState.Hand()
  } else if (model.homeScreenSteps.isOpen) {
    return MenuState.InstallSteps()
  } else if (model.updateGreeting.isOpen) {
    return MenuState.UpdateGreeting()
  } else if (isHeroPickerUp(model.lobby)) {
    return MenuState.HeroPicker()
  } else if (isLobbyUp(model)) {
    return MenuState.Lobby()
  } else if (isCoopScreenOpen(model.coop)) {
    return MenuState.Coop()
  } else {
    return phaseState(model)
  }
}

// NOTE: the bare home menu, nothing over it: its focus moves, its keys
// work, and its buttons open panels, the hand, the Profile, and co-op.
export const isOnHomeMenu = (model: Model): boolean =>
  MenuState.isAnyOf(['Home'])(menuState(model))

// NOTE: the lobby is on screen, whatever dialog is over it (the hero picker).
export const isLobbyUp = (model: Model): boolean => isLobbyShown(model.lobby)

export const isLobbyOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Lobby'])(menuState(model))

export const isProfileOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Profile'])(menuState(model))

export const isProfileOpenOn: {
  (tab: ProfileTab): (model: Model) => boolean
  (model: Model, tab: ProfileTab): boolean
} = Function.dual(2, (model: Model, tab: ProfileTab): boolean =>
  MenuState.matchOrElse(
    menuState(model),
    { Profile: profile => profile.tab === tab },
    () => false,
  ),
)

export const isPanelOpen: {
  (panel: MenuPanel): (model: Model) => boolean
  (model: Model, panel: MenuPanel): boolean
} = Function.dual(2, (model: Model, panel: MenuPanel): boolean =>
  MenuState.matchOrElse(
    menuState(model),
    { Panel: open => open.panel === panel },
    () => false,
  ),
)

export const isAnyPanelOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Panel'])(menuState(model))

export const isHandOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Hand'])(menuState(model))
