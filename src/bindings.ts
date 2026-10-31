import { DialogBlock } from '@foldkit/ui'

import { CharacterBlock } from './characterBlock'
import { CoopBlock } from './coop'
import { makeBinding } from './definition'
import { isProfileOpen } from './menuState'
import { ProfileTabsBlock } from './profile'
import { isBrowsing } from './shop'
import { ShopTabsBlock } from './shopTabs'

// NOTE: every child of the root, each placed on its Model field, so its
// generated Message is `Got<Field>Message` (GotShopDialogMessage). The
// root's own Model fields hold their state (`init: false`): see
// initialModel in src/model.ts. Steps and views call these Bindings'
// operations and views; their OutMessage folds, which call Steps, are
// chosen in src/composition.ts, so no Step imports the module that imports
// it (FOLDKIT.md, "OutMessage policies").

// DIALOGS

export const ShopDialogBinding = makeBinding(DialogBlock, {
  field: 'shopDialog',
  init: false,
})

export const ProfileDialogBinding = makeBinding(DialogBlock, {
  field: 'profileDialog',
  init: false,
})

export const PanelDialogBinding = makeBinding(DialogBlock, {
  field: 'panelDialog',
  init: false,
})

export const HandDialogBinding = makeBinding(DialogBlock, {
  field: 'handDialog',
  init: false,
})

export const HomeScreenStepsBinding = makeBinding(DialogBlock, {
  field: 'homeScreenSteps',
  init: false,
})

export const UpdateGreetingBinding = makeBinding(DialogBlock, {
  field: 'updateGreeting',
  init: false,
})

// TABS

// NOTE: tabs only answer while their dialog is up.
export const ProfileTabsBinding = makeBinding(ProfileTabsBlock, {
  field: 'profileTabs',
  init: false,
  delivery: { when: isProfileOpen },
})

export const ShopTabsBinding = makeBinding(ShopTabsBlock, {
  field: 'shopTabs',
  init: false,
  delivery: { when: model => isBrowsing(model.shop) },
})

// THE LOOK TAB

export const CharacterBinding = makeBinding(CharacterBlock, {
  field: 'character',
  init: false,
})

// CO-OP

export const CoopBinding = makeBinding(CoopBlock, {
  field: 'coop',
  init: false,
})
