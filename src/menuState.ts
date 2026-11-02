import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { RESTART_GRACE_MS } from './constants'
import { isOpen as isCoopScreenOpen } from './coop/update'
import { MenuPanel, type Model, Phase, ProfileTab } from './model'

// NOTE: what the player is looking at, derived from the Model and never
// stored. Update's gates and the view both read it, so "is a menu open"
// has one answer. The dialogs come first, top to bottom (the shop's
// dialog also opens in a co-op run), then the single player lobby, then
// co-op's own screens, then the phase. Only this module reads a dialog's `isOpen` or `model.coop.screen`
// (munch/no-menu-field).
export const MenuState = defineTaggedUnion({
  Shop: {},
  Profile: { tab: ProfileTab },
  Panel: { panel: MenuPanel },
  Hand: {},
  InstallSteps: {},
  UpdateGreeting: {},
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
    Victory: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
    GameOver: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
  })

export const menuState = (model: Model): MenuState => {
  if (model.shopDialog.isOpen) {
    return MenuState.Shop()
  } else if (model.profileDialog.isOpen) {
    return MenuState.Profile({ tab: model.profile.tab })
  } else if (model.panelDialog.isOpen) {
    return MenuState.Panel({ panel: model.panel })
  } else if (model.handDialog.isOpen) {
    return MenuState.Hand()
  } else if (model.homeScreenSteps.isOpen) {
    return MenuState.InstallSteps()
  } else if (model.updateGreeting.isOpen) {
    return MenuState.UpdateGreeting()
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
export const isLobbyUp = (model: Model): boolean => model.home.lobby === 'Open'

export const isLobbyOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Lobby'])(menuState(model))

export const isProfileOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Profile'])(menuState(model))

export const isProfileOpenOn = (model: Model, tab: ProfileTab): boolean =>
  MenuState.matchOrElse(
    menuState(model),
    { Profile: profile => profile.tab === tab },
    () => false,
  )

export const isPanelOpen = (model: Model, panel: MenuPanel): boolean =>
  MenuState.matchOrElse(
    menuState(model),
    { Panel: open => open.panel === panel },
    () => false,
  )

export const isAnyPanelOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Panel'])(menuState(model))

export const isHandOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Hand'])(menuState(model))

export const isShopDialogOpen = (model: Model): boolean =>
  MenuState.isAnyOf(['Shop'])(menuState(model))
