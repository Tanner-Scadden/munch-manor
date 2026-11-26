import { Function, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { isOpen as isCoopScreenOpen } from '../features/coop/update'
import { MenuPanel } from '../features/home/homeSchema'
import { isHeroPickerUp, isLobbyShown } from '../features/lobby/model'
import { ProfileTab } from '../features/profile/model'
import { tabOf } from '../features/profile/profile'
import { RESTART_GRACE_MS } from '../shared/constants'
import { type Model, Phase } from './model'
import { RootDialog } from './rootDialog'

export const MenuState = UiSchema.TaggedEnum({
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

export const isPastRestartGrace = (model: Model): boolean =>
  model.screenMs >= RESTART_GRACE_MS

const phaseState = (model: Model): MenuState =>
  Phase.match(model.phase, {
    Ready: () => MenuState.Home(),
    Arriving: () => MenuState.Playing(),
    Preparation: () => MenuState.Playing(),
    Wave: () => MenuState.Playing(),
    Paused: () => MenuState.Paused(),
    Escaped: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
    LeftEarly: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
    GameOver: () =>
      MenuState.EndScreen({ isPastGrace: isPastRestartGrace(model) }),
  })

export const menuState = (model: Model): MenuState =>
  RootDialog.$match(model.rootDialog, {
    Shut: () => belowDialogs(model),
    Profile: () => MenuState.Profile({ tab: tabOf(model.profile) }),
    Panel: () => MenuState.Panel({ panel: model.panel }),
    Hand: () => MenuState.Hand(),
    HomeScreenSteps: () => MenuState.InstallSteps(),
    UpdateGreeting: () => MenuState.UpdateGreeting(),
  })

const belowDialogs = (model: Model): MenuState => {
  if (isHeroPickerUp(model.lobby)) {
    return MenuState.HeroPicker()
  } else if (isLobbyUp(model)) {
    return MenuState.Lobby()
  } else if (isCoopScreenOpen(model.coop)) {
    return MenuState.Coop()
  } else {
    return phaseState(model)
  }
}

export const isOnHomeMenu = (model: Model): boolean =>
  MenuState.isAnyOf(['Home'])(menuState(model))

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
