import type { Block } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import { CoopBlock } from '../features/coop'
import { forgetAskedMode } from '../features/home/update'
import { ProfileBlock } from '../features/profile/block'
import { isGuideEscape, reopenForGuide } from '../features/shop/guideUpdate'
import { ShopTabsBlock } from '../features/shop/shopTabs'
import { leaveShop, selectCategory } from '../features/shop/update'
import {
  CoopBinding,
  HandDialogBinding,
  HomeScreenStepsBinding,
  PanelDialogBinding,
  ProfileBinding,
  ProfileDialogBinding,
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
import {
  buyLook,
  chooseLook,
  clickedSetting,
  flipLook,
  keepName,
  keepProfileName,
  linkedDevice,
  resetTutorial,
  rollLook,
  rollNameDice,
  showedLinkCode,
  submitName,
  switchedTab,
} from './update/profile'

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
      Closed: () => keepProfileName,
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

const ShopTabsBindingWithOutMessagePolicy =
  ShopTabsBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(ShopTabsBlock, {
      Selected: ({ value }) => selectCategory(value),
    }),
  })

// THE PROFILE

// NOTE: the Profile tells what happened; the root keeps the name, toggles
// the setting, forgets the tutorial, changes the look and the Bones, and
// plays the sound. The dice and a Look pick answer back through
// ProfileBinding (src/app/update/profile.ts).
const ProfileBindingWithOutMessagePolicy = ProfileBinding.withOutMessagePolicy({
  fold: ApplicationBlock.makeOutMessageFold(ProfileBlock, {
    SwitchedTab: switchedTab,
    KeptName: ({ name }) => keepName(name),
    SubmittedName: ({ name }) => submitName(name),
    RolledNameDice: ({ current }) => rollNameDice(current),
    ClickedSetting: ({ setting }) => clickedSetting(setting),
    ConfirmedTutorialReset: () => resetTutorial,
    ShowedLinkCode: () => showedLinkCode,
    LinkedDevice: () => linkedDevice,
    ChoseLook: chooseLook,
    FlippedLook: ({ toggle }) => flipLook(toggle),
    RolledLookDice: () => rollLook,
    ClickedBuyLook: buyLook,
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
    PanelDialogBindingWithOutMessagePolicy,
    HandDialogBindingWithOutMessagePolicy,
    HomeScreenStepsBindingWithOutMessagePolicy,
    UpdateGreetingBindingWithOutMessagePolicy,
    ProfileBindingWithOutMessagePolicy,
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
