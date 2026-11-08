import { DialogBlock } from '@foldkit/ui'

import { CoopBlock } from '../features/coop'
import { lobbyPicksOf } from '../features/home/home'
import { LobbyBlock } from '../features/lobby/block'
import { MunchopediaBlock } from '../features/munchopedia/block'
import { ProfileBlock } from '../features/profile/block'
import { ShopBlock } from '../features/shop/block'
import {
  HAND_DIALOG_ID,
  HOME_SCREEN_STEPS_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
  UPDATE_GREETING_ID,
} from './clientSchema'
import { makeRequiredFieldBinding } from './definition'
import { isPanelOpen } from './menuState'

// NOTE: every child of the root, each placed on its Model field, so its
// generated Message is `Got<Field>Message` (GotShopDialogMessage). Each
// child starts closed from its own init when the root's init runs, so the
// root's init (src/app/main.ts) supplies only its own fields. Steps and views
// call these Bindings' operations and views; their OutMessage folds, which
// call Steps, are chosen in src/app/composition.ts, so no Step imports the
// module that imports it (FOLDKIT.md, "OutMessage policies").

// DIALOGS

export const ProfileDialogBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'profileDialog',
  init: { contextToArgs: () => [{ id: PROFILE_DIALOG_ID }] },
})

export const PanelDialogBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'panelDialog',
  init: { contextToArgs: () => [{ id: PANEL_DIALOG_ID }] },
})

export const HandDialogBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'handDialog',
  init: { contextToArgs: () => [{ id: HAND_DIALOG_ID }] },
})

export const HomeScreenStepsBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'homeScreenSteps',
  init: { contextToArgs: () => [{ id: HOME_SCREEN_STEPS_ID }] },
})

export const UpdateGreetingBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'updateGreeting',
  init: { contextToArgs: () => [{ id: UPDATE_GREETING_ID }] },
})

// THE SHOP

// NOTE: Rattles' shop dialog, with its tabs and its guide inside. It
// follows the World's shop (syncShopDialog in src/app/update/shop.ts).
export const ShopDialogBinding = makeRequiredFieldBinding(ShopBlock, {
  field: 'shopDialog',
})

// THE MUNCHOPEDIA

// NOTE: the Munchopedia in the menu panel, with the shop guide inside for
// its Shop page. Its taps count only while its panel is up.
export const MunchopediaBinding = makeRequiredFieldBinding(MunchopediaBlock, {
  field: 'munchopedia',
  delivery: { when: model => isPanelOpen(model, 'Munchopedia') },
})

// THE PROFILE

// NOTE: the Profile panel inside ProfileDialogBinding's Dialog: its tabs,
// the Look tab, the name being typed, and the device link flow.
export const ProfileBinding = makeRequiredFieldBinding(ProfileBlock, {
  field: 'profile',
})

// THE LOBBY

// NOTE: the single player lobby PLAY opens, with its hero picker inside.
// The picks are the root's, handed to its update as context.
export const LobbyBinding = makeRequiredFieldBinding(LobbyBlock, {
  field: 'lobby',
  delivery: { toUpdateContext: model => [lobbyPicksOf(model)] },
})

// CO-OP

export const CoopBinding = makeRequiredFieldBinding(CoopBlock, {
  field: 'coop',
})
