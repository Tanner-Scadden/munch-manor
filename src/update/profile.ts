import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ProfileDialogBinding } from '../bindings'
import { makeStep } from '../definition'
import { isCharacterKey, releaseAll } from '../input'
import { MenuState, isProfileOpen, menuState } from '../menuState'
import type { Model, ProfileTab } from '../model'
import {
  cleanName,
  draftName,
  rollName,
  shownName,
  withProfileFx,
} from '../profile'
import { stepWhen } from '../stepWhen'
import { playSounds, uiCue } from './sound'
import {
  type UpdateReturn,
  type UpdateStep,
  modelStep,
  unchanged,
  withInput,
} from './step'
import { markLooksSeen } from './unlocks'

// NAME

// NOTE: the name is kept, and so saved and synced, when the player is done
// typing: Enter, leaving the field, another tab, or closing the Profile.
// Saving on every key would send a sync mutation per letter.
const keepNameModel = (model: Model): Model => {
  const name = cleanName(model.profile.nameDraft)
  return modifyFields(model, {
    playerName: () => name,
    profile: profile => modifyFields(profile, { nameDraft: () => name }),
  })
}

export const keepName = modelStep(keepNameModel)

export const typeName = (model: Model, value: string): UpdateReturn => ({
  model: isProfileOpen(model)
    ? modifyFields(model, {
        profile: profile =>
          modifyFields(profile, {
            nameDraft: () => draftName(value),
            fx: () => 'Still',
          }),
      })
    : model,
})

export const submitName = stepWhen(isProfileOpen, model =>
  playSounds([uiCue('Pop')])(keepNameModel(model)),
)

export const leaveNameInput = stepWhen(isProfileOpen, keepName)

export const rollNameDice = stepWhen(isProfileOpen, model => {
  const [rngState, name] = rollName(
    model.cosmeticRngState,
    shownName(cleanName(model.profile.nameDraft)),
  )
  return playSounds([uiCue('LootPop')])(
    withProfileFx(
      modifyFields(model, {
        cosmeticRngState: () => rngState,
        playerName: () => name,
        profile: profile => modifyFields(profile, { nameDraft: () => name }),
      }),
      'Spin',
    ),
  )
})

// DIALOG

// NOTE: the Profile opens from the bare home menu, and from the end screens
// once their grace is past, as the character picker always did. Never in a
// run, and never over co-op or another dialog.
const canOpenProfile = (model: Model): boolean =>
  MenuState.matchOrElse(
    menuState(model),
    {
      Home: () => true,
      EndScreen: ({ isPastGrace }) => isPastGrace,
    },
    () => false,
  )

const showTab = (model: Model, tab: ProfileTab): Model =>
  modifyFields(tab === 'Look' ? markLooksSeen(model) : model, {
    tutorialReset: () => 'Idle',
    profile: profile =>
      modifyFields(profile, { tab: () => tab, fx: () => 'Still' }),
  })

const prepareProfile =
  (tab: ProfileTab): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(showTab(stepModel, tab), {
        profile: profile =>
          modifyFields(profile, { nameDraft: () => stepModel.playerName }),
      }),
      releaseAll,
    ),
  })

export const openProfile = (tab: ProfileTab) =>
  makeStep(model =>
    canOpenProfile(model)
      ? Update.combineSteps([
          prepareProfile(tab),
          ProfileDialogBinding.requestOpen(),
        ])
      : unchanged,
  )

export const profileFromKey = (code: string) =>
  makeStep(() => (isCharacterKey(code) ? openProfile('Look') : unchanged))

// TABS

export const switchTab = (tab: ProfileTab): UpdateStep =>
  stepWhen(
    model => tab !== model.profile.tab,
    model => playSounds([uiCue('Whoosh')])(showTab(keepNameModel(model), tab)),
  )
