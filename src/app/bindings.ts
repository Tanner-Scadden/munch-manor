import { DialogBlock } from '@foldkit/ui'

import {
  HAND_DIALOG_ID,
  HOME_SCREEN_STEPS_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
  UPDATE_GREETING_ID,
} from '../domain/clientSchema'
import { CoopBlock } from '../features/coop'
import { LobbyBlock } from '../features/lobby/block'
import { MunchopediaBlock } from '../features/munchopedia/block'
import { ProfileBlock } from '../features/profile/block'
import { ProofShelfBlock } from '../features/proof/block'
import { lobbyPicksOf } from '../screens/home/home'
import { makeRequiredFieldBinding } from './definition'
import { isPanelOpen } from './menuState'

// NOTE: every child of the root, each placed on its Model field, so its
// generated Message is `Got<Field>Message` (GotLobbyMessage). Each
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

// THE MUNCHOPEDIA

// NOTE: the Munchopedia in the menu panel, with the guide to the house's
// finds inside for its Finds page. Its taps count only while its panel is up.
export const MunchopediaBinding = makeRequiredFieldBinding(MunchopediaBlock, {
  field: 'munchopedia',
  delivery: { when: model => isPanelOpen(model, 'Munchopedia') },
})

// THE PROOF SHELF

// NOTE: the Proof Shelf in the menu panel. Its taps and keys count only
// while its panel is up.
export const ProofShelfBinding = makeRequiredFieldBinding(ProofShelfBlock, {
  field: 'proofShelf',
  delivery: { when: model => isPanelOpen(model, 'Proof') },
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
