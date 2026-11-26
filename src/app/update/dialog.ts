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

const FIELD_OF = {
  Profile: 'profileDialog',
  Panel: 'panelDialog',
  Hand: 'handDialog',
  HomeScreenSteps: 'homeScreenSteps',
  UpdateGreeting: 'updateGreeting',
} as const satisfies Record<DialogName, keyof Model>

export const keepName = (model: Model): Model =>
  UiStruct.evolve(model, {
    playerName: () => keptName(model.profile),
    profile: withNameKept,
  })

const forgetAskedMode = (model: Model): Model =>
  DifficultyCard.isAnyOf(['Asking'])(model.difficultyCard)
    ? UiStruct.evolve(model, {
        difficultyCard: () => DifficultyCard.Unseen(),
      })
    : model

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
