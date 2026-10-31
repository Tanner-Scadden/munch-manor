import { type Block, Update } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import {
  CharacterBinding,
  CoopBinding,
  HandDialogBinding,
  HomeScreenStepsBinding,
  PanelDialogBinding,
  ProfileDialogBinding,
  ProfileTabsBinding,
  ShopDialogBinding,
  ShopTabsBinding,
  UpdateGreetingBinding,
} from './bindings'
import { CharacterBlock } from './characterBlock'
import { CoopBlock } from './coop'
import {
  makeComposition,
  makeNoopStep,
  makeOutMessageFold,
  makeStep,
} from './definition'
import { mounts } from './mount'
import { ProfileTabsBlock } from './profile'
import { ShopTabsBlock } from './shopTabs'
import { chooseLook, flipLook, rollLook } from './update/character'
import { closedCoop, leftRoom, neededNewerBuild } from './update/coop'
import { forgetAskedMode } from './update/home'
import { keepName, switchTab } from './update/profile'
import { afterMessage, settled } from './update/settle'
import { leaveShop, selectCategory } from './update/shop'

// NOTE: each child's OutMessage fold. The Bindings live in src/bindings.ts,
// where Steps and views reach them; these folds call Steps, so they stay
// here, and only the Composition registers the Bindings with them. A fold
// changes the root, so it is `settled`: the root's after-message Steps
// (music, save, run count) run on it as they do after a local Message.

// DIALOGS

const ShopDialogBindingWithOutMessagePolicy =
  ShopDialogBinding.withOutMessagePolicy({
    fold: makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () =>
        makeStep(before =>
          Update.combineSteps([leaveShop, ...afterMessage(before)]),
        ),
      CompletedClose: makeNoopStep,
    }),
  })

const ProfileDialogBindingWithOutMessagePolicy =
  ProfileDialogBinding.withOutMessagePolicy({
    fold: makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => settled(keepName),
      CompletedClose: makeNoopStep,
    }),
  })

const PanelDialogBindingWithOutMessagePolicy =
  PanelDialogBinding.withOutMessagePolicy({
    fold: makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => settled(forgetAskedMode),
      CompletedClose: makeNoopStep,
    }),
  })

const dialogWithoutPolicy = makeOutMessageFold(DialogBlock, {
  Opened: makeNoopStep,
  Closed: makeNoopStep,
  CompletedClose: makeNoopStep,
})

const HandDialogBindingWithOutMessagePolicy =
  HandDialogBinding.withOutMessagePolicy({ fold: dialogWithoutPolicy })

const HomeScreenStepsBindingWithOutMessagePolicy =
  HomeScreenStepsBinding.withOutMessagePolicy({ fold: dialogWithoutPolicy })

const UpdateGreetingBindingWithOutMessagePolicy =
  UpdateGreetingBinding.withOutMessagePolicy({ fold: dialogWithoutPolicy })

// TABS

const ProfileTabsBindingWithOutMessagePolicy =
  ProfileTabsBinding.withOutMessagePolicy({
    fold: makeOutMessageFold(ProfileTabsBlock, {
      Selected: ({ value }) => settled(switchTab(value)),
    }),
  })

const ShopTabsBindingWithOutMessagePolicy =
  ShopTabsBinding.withOutMessagePolicy({
    fold: makeOutMessageFold(ShopTabsBlock, {
      Selected: ({ value }) => settled(selectCategory(value)),
    }),
  })

// THE LOOK TAB

const CharacterBindingWithOutMessagePolicy =
  CharacterBinding.withOutMessagePolicy({
    fold: makeOutMessageFold(CharacterBlock, {
      ChoseLook: ({ part, value }) => settled(chooseLook(part, value)),
      FlippedLook: ({ toggle }) => settled(flipLook(toggle)),
      RequestedRandomLook: () => settled(rollLook),
    }),
  })

// CO-OP

const CoopBindingWithOutMessagePolicy = CoopBinding.withOutMessagePolicy({
  fold: makeOutMessageFold(CoopBlock, {
    ClosedCoop: () => settled(closedCoop),
    NeededNewerBuild: () => settled(neededNewerBuild),
    LeftRoom: () => settled(leftRoom),
  }),
})

export const ApplicationComposition = makeComposition({
  bindings: [
    ShopDialogBindingWithOutMessagePolicy,
    ShopTabsBindingWithOutMessagePolicy,
    ProfileDialogBindingWithOutMessagePolicy,
    ProfileTabsBindingWithOutMessagePolicy,
    PanelDialogBindingWithOutMessagePolicy,
    HandDialogBindingWithOutMessagePolicy,
    HomeScreenStepsBindingWithOutMessagePolicy,
    UpdateGreetingBindingWithOutMessagePolicy,
    CharacterBindingWithOutMessagePolicy,
    CoopBindingWithOutMessagePolicy,
  ],
  mounts,
})
export type ApplicationViewBuilder = Block.ViewBuilderFor<
  typeof ApplicationComposition
>
// NOTE: an attribute the root's view builder makes, carrying the root's
// whole Message, its children's included.
export type ApplicationAttribute = Parameters<
  ApplicationViewBuilder['div']
>[0][number]
