import type { Block } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import { CoopBlock } from '../features/coop'
import { LobbyBlock } from '../features/lobby/block'
import { MunchopediaBlock } from '../features/munchopedia/block'
import { ProfileBlock } from '../features/profile/block'
import { openedEntry } from '../screens/home/home'
import {
  CoopBinding,
  HandDialogBinding,
  HomeScreenStepsBinding,
  LobbyBinding,
  MunchopediaBinding,
  PanelDialogBinding,
  ProfileBinding,
  ProfileDialogBinding,
  UpdateGreetingBinding,
} from './bindings'
import { ApplicationBlock, makeComposition, makeNoopStep } from './definition'
import { mounts } from './mount'
import {
  boughtCalling,
  choseCalling,
  choseName,
  closedCoop,
  leftRoom,
  neededNewerBuild,
} from './update/coop'
import { forgetAskedMode } from './update/home'
import {
  addLobbyBot,
  buyHero,
  chooseLobbyDifficulty,
  chooseMode,
  dropLobbyBot,
  leaveLobby,
  openHeroPicker,
  pickHero,
  startFromLobby,
  toggleModifier,
} from './update/lobby'
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
import { modelStep } from './update/step'

// NOTE: each child's OutMessage fold. The Bindings live in src/app/bindings.ts,
// where Steps and views reach them; these folds call Steps, so they stay
// here, and only the Composition registers the Bindings with them. The
// root's after-message Steps (music, save, run count) run once after the
// whole delivery, fold included, from `update` in src/app/main.ts.

// DIALOGS

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

// THE MUNCHOPEDIA

// NOTE: an entry opened clears its NEW ENTRY, and a zombie already found is
// saved as opened.
const MunchopediaBindingWithOutMessagePolicy =
  MunchopediaBinding.withOutMessagePolicy({
    fold: ApplicationBlock.makeOutMessageFold(MunchopediaBlock, {
      OpenedEntry: ({ kind }) => modelStep(model => openedEntry(model, kind)),
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

// THE LOBBY

// NOTE: the lobby tells what happened; the root makes each pick on its own
// fields and taps, starts the run or goes home, rolls a bot, and judges a
// hero card and BUY, answering back through LobbyBinding
// (src/app/update/lobby.ts).
const LobbyBindingWithOutMessagePolicy = LobbyBinding.withOutMessagePolicy({
  fold: ApplicationBlock.makeOutMessageFold(LobbyBlock, {
    Started: () => startFromLobby,
    Left: () => leaveLobby,
    ChoseMode: ({ mode }) => chooseMode(mode),
    ChoseDifficulty: ({ difficulty }) => chooseLobbyDifficulty(difficulty),
    ToggledModifier: ({ modifier }) => toggleModifier(modifier),
    ClickedAddBot: () => addLobbyBot,
    DroppedBot: ({ index }) => dropLobbyBot(index),
    OpenedHeroPicker: () => openHeroPicker,
    PickedHero: pickHero,
    ClickedBuyHero: ({ calling }) => buyHero(calling),
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
    ProfileDialogBindingWithOutMessagePolicy,
    PanelDialogBindingWithOutMessagePolicy,
    HandDialogBindingWithOutMessagePolicy,
    HomeScreenStepsBindingWithOutMessagePolicy,
    UpdateGreetingBindingWithOutMessagePolicy,
    ProfileBindingWithOutMessagePolicy,
    LobbyBindingWithOutMessagePolicy,
    MunchopediaBindingWithOutMessagePolicy,
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
