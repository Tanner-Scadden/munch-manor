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
  ApplicationDefinition,
  makeComposition,
  makeNoopStep,
  makeStep,
} from './definition'
import { mounts } from './mount'
import { ProfileTabsBlock } from './profile'
import { ShopTabsBlock } from './shopTabs'
import { buyPreview, chooseLook, flipLook, rollLook } from './update/character'
import {
  boughtCalling,
  choseCalling,
  choseName,
  closedCoop,
  leftRoom,
  neededNewerBuild,
} from './update/coop'
import { forgetAskedMode } from './update/home'
import { keepName, switchTab } from './update/profile'
import { afterMessage, settled } from './update/settle'
import { leaveShop, selectCategory } from './update/shop'
import { isGuideEscape, reopenForGuide } from './update/shopGuide'

// NOTE: each child's OutMessage fold. The Bindings live in src/bindings.ts,
// where Steps and views reach them; these folds call Steps, so they stay
// here, and only the Composition registers the Bindings with them. A fold
// changes the root, so it is `settled`: the root's after-message Steps
// (music, save, run count) run on it as they do after a local Message.

// DIALOGS

const ShopDialogBindingWithOutMessagePolicy =
  ShopDialogBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () =>
        makeStep(before =>
          isGuideEscape(before)
            ? reopenForGuide
            : Update.combineSteps([leaveShop, ...afterMessage(before)]),
        ),
      CompletedClose: makeNoopStep,
    }),
  })

const ProfileDialogBindingWithOutMessagePolicy =
  ProfileDialogBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => settled(keepName),
      CompletedClose: makeNoopStep,
    }),
  })

const PanelDialogBindingWithOutMessagePolicy =
  PanelDialogBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => settled(forgetAskedMode),
      CompletedClose: makeNoopStep,
    }),
  })

const dialogWithoutPolicy = ApplicationDefinition.makeOutMessageFold(
  DialogBlock,
  {
    Opened: makeNoopStep,
    Closed: makeNoopStep,
    CompletedClose: makeNoopStep,
  },
)

const HandDialogBindingWithOutMessagePolicy =
  HandDialogBinding.withOutMessagePolicy({ fold: dialogWithoutPolicy })

const HomeScreenStepsBindingWithOutMessagePolicy =
  HomeScreenStepsBinding.withOutMessagePolicy({ fold: dialogWithoutPolicy })

const UpdateGreetingBindingWithOutMessagePolicy =
  UpdateGreetingBinding.withOutMessagePolicy({ fold: dialogWithoutPolicy })

// TABS

const ProfileTabsBindingWithOutMessagePolicy =
  ProfileTabsBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(ProfileTabsBlock, {
      Selected: ({ value }) => settled(switchTab(value)),
    }),
  })

const ShopTabsBindingWithOutMessagePolicy =
  ShopTabsBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(ShopTabsBlock, {
      Selected: ({ value }) => settled(selectCategory(value)),
    }),
  })

// THE LOOK TAB

const CharacterBindingWithOutMessagePolicy =
  CharacterBinding.withOutMessagePolicy({
    fold: ApplicationDefinition.makeOutMessageFold(CharacterBlock, {
      ChoseLook: ({ part, value }) => settled(chooseLook(part, value)),
      FlippedLook: ({ toggle }) => settled(flipLook(toggle)),
      RequestedRandomLook: () => settled(rollLook),
      RequestedBuy: () => settled(buyPreview),
    }),
  })

// CO-OP

const CoopBindingWithOutMessagePolicy = CoopBinding.withOutMessagePolicy({
  fold: ApplicationDefinition.makeOutMessageFold(CoopBlock, {
    ClosedCoop: () => settled(closedCoop),
    NeededNewerBuild: () => settled(neededNewerBuild),
    LeftRoom: () => settled(leftRoom),
    ChoseCalling: ({ calling }) => settled(choseCalling(calling)),
    ChoseName: ({ name }) => settled(choseName(name)),
    BoughtCalling: ({ calling }) =>
      makeStep(before =>
        Update.combineSteps([boughtCalling(calling), ...afterMessage(before)]),
      ),
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
