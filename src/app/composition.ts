import type { Block } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import { CoopBlock } from '../features/coop'
import { forgetAskedMode } from '../features/home/update'
import { CharacterBlock } from '../features/look/block'
import { ProfileTabsBlock } from '../features/profile/profile'
import { keepName, switchTab } from '../features/profile/update'
import { isGuideEscape, reopenForGuide } from '../features/shop/guideUpdate'
import { ShopTabsBlock } from '../features/shop/shopTabs'
import { leaveShop, selectCategory } from '../features/shop/update'
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
import {
  ApplicationBlock,
  makeComposition,
  makeNoopStep,
  makeStep,
} from './definition'
import { mounts } from './mount'
import {
  boughtCalling,
  choseCalling,
  choseName,
  closedCoop,
  leftRoom,
  neededNewerBuild,
} from './update/coop'
import { buyPreview, chooseLook, flipLook, rollLook } from './update/look'

// NOTE: each child's OutMessage fold. The Bindings live in src/app/bindings.ts,
// where Steps and views reach them; these folds call Steps, so they stay
// here, and only the Composition registers the Bindings with them. The
// root's after-message Steps (music, save, run count) run once after the
// whole delivery, fold included, from `update` in src/app/main.ts.

// DIALOGS

const ShopDialogBindingWithOutMessagePolicy =
  ShopDialogBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () =>
        makeStep(before =>
          isGuideEscape(before) ? reopenForGuide : leaveShop,
        ),
      CompletedClose: makeNoopStep,
    }),
  })

const ProfileDialogBindingWithOutMessagePolicy =
  ProfileDialogBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => keepName,
      CompletedClose: makeNoopStep,
    }),
  })

const PanelDialogBindingWithOutMessagePolicy =
  PanelDialogBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => forgetAskedMode,
      CompletedClose: makeNoopStep,
    }),
  })

const dialogWithoutPolicy = ApplicationBlock.makeOutMessageFold(DialogBlock, {
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
    fold: ApplicationBlock.makeOutMessageFold(ProfileTabsBlock, {
      Selected: ({ value }) => switchTab(value),
    }),
  })

const ShopTabsBindingWithOutMessagePolicy =
  ShopTabsBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(ShopTabsBlock, {
      Selected: ({ value }) => selectCategory(value),
    }),
  })

// THE LOOK TAB

const CharacterBindingWithOutMessagePolicy =
  CharacterBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(CharacterBlock, {
      ChoseLook: ({ part, value }) => chooseLook(part, value),
      FlippedLook: ({ toggle }) => flipLook(toggle),
      RolledDice: () => rollLook,
      ClickedBuy: () => buyPreview,
    }),
  })

// CO-OP

const CoopBindingWithOutMessagePolicy = CoopBinding.withOutMessagePolicy({
  fold: ApplicationBlock.makeOutMessageFold(CoopBlock, {
    ClosedCoop: () => closedCoop,
    NeededNewerBuild: () => neededNewerBuild,
    LeftRoom: () => leftRoom,
    ChoseCalling: ({ calling }) => choseCalling(calling),
    ChoseName: ({ name }) => choseName(name),
    BoughtCalling: ({ calling }) => boughtCalling(calling),
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
