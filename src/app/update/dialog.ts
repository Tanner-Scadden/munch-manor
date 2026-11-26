import { UiStruct } from '@effect/ui'

import { keptName, withNameKept } from '../../features/profile/steps'
import { openedEntry } from '../../screens/home/home'
import { stepWhen } from '../../shared/stepWhen'
import { closedDialog, openDialog } from '../../ui/dialog'
import type { DialogName } from '../message'
import { DifficultyCard, type Model } from '../model'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step'

// NOTE: the Model field each root dialog opens on.
const FIELD_OF = {
  Profile: 'profileDialog',
  Panel: 'panelDialog',
  Hand: 'handDialog',
  HomeScreenSteps: 'homeScreenSteps',
  UpdateGreeting: 'updateGreeting',
} as const satisfies Record<DialogName, keyof Model>

// NOTE: the name is kept, and so saved and synced, when the player is done
// typing: leaving the field, another tab, or closing the Profile (Enter is
// SubmittedProfileName, with its pop). Saving on every key would send a
// sync mutation per letter.
export const keepName = (model: Model): Model =>
  UiStruct.evolve(model, {
    playerName: () => keptName(model.profile),
    profile: withNameKept,
  })

// NOTE: a Difficulty panel that asked before a run, closed without a pick,
// asks again next time.
const forgetAskedMode = (model: Model): Model =>
  DifficultyCard.isAnyOf(['Asking'])(model.difficultyCard)
    ? UiStruct.evolve(model, {
        difficultyCard: () => DifficultyCard.Unseen(),
      })
    : model

// NOTE: what the root does as a dialog closes, past shutting it: the
// Profile keeps the name being typed, and the menu panel forgets a
// difficulty question left unanswered.
const AFTER_CLOSE: Record<DialogName, UpdateStep> = {
  Profile: modelStep(keepName),
  Panel: modelStep(forgetAskedMode),
  Hand: unchanged,
  HomeScreenSteps: unchanged,
  UpdateGreeting: unchanged,
}

const isDialogOpen = (model: Model, dialog: DialogName): boolean =>
  model[FIELD_OF[dialog]].isOpen

export const openRootDialog = (dialog: DialogName): UpdateStep =>
  modelStep(model =>
    UiStruct.evolve(model, { [FIELD_OF[dialog]]: () => openDialog }),
  )

// NOTE: a close only acts on an open dialog, so the `close` event the
// browser fires after the Model shut it does nothing a second time.
export const closeRootDialog = (dialog: DialogName): UpdateStep =>
  stepWhen(
    (model: Model) => isDialogOpen(model, dialog),
    combine([
      modelStep(model =>
        UiStruct.evolve(model, { [FIELD_OF[dialog]]: () => closedDialog }),
      ),
      AFTER_CLOSE[dialog],
    ]),
  )

export const dialogHandlers = defineHandlers({
  ClosedDialog: ($, { dialog }) => closeRootDialog(dialog)($),
  OpenedMunchopediaEntry: ($, { kind }) => openedEntry($.model, kind),
  ChangedMunchopediaPage: ($, { page }) =>
    $.evolve({ munchopediaPage: () => page }),
})
