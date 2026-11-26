import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import {
  DialogEvent,
  type DialogName,
  stepRootDialog,
} from '#app/rootDialog.ts'
import { CardEvent, stepDifficultyCard } from '#domain/difficultyCard.ts'
import { keptName, withNameKept } from '#features/profile/steps.ts'
import { openedEntry } from '#screens/home/home.ts'

import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step.ts'

export const keepName = (model: Model): Model =>
  UiStruct.evolve(model, {
    playerName: () => keptName(model.profile),
    profile: withNameKept,
  })

const forgetAskedMode = (model: Model): Model =>
  UiStruct.evolve(model, {
    difficultyCard: card => stepDifficultyCard(card, CardEvent.WentBack),
  })

const AFTER_CLOSE: Record<DialogName, UpdateStep> = {
  Profile: modelStep(keepName),
  Panel: modelStep(forgetAskedMode),
  Hand: unchanged,
  HomeScreenSteps: unchanged,
  UpdateGreeting: unchanged,
}

const moveDialog =
  (event: DialogEvent, onMoved: UpdateStep): UpdateStep =>
  $ => {
    const after = stepRootDialog($.model.rootDialog, event)
    const moved = combine([
      modelStep(model => UiStruct.evolve(model, { rootDialog: () => after })),
      onMoved,
    ])
    return (after === $.model.rootDialog ? unchanged : moved)($)
  }

export const openRootDialog = (dialog: DialogName): UpdateStep =>
  moveDialog(DialogEvent.Opened({ dialog }), unchanged)

export const closeRootDialog = (dialog: DialogName): UpdateStep =>
  moveDialog(DialogEvent.Closed({ dialog }), AFTER_CLOSE[dialog])

export const dialogHandlers = defineHandlers({
  ClosedDialog: ($, { dialog }) => closeRootDialog(dialog)($),
  OpenedMunchopediaEntry: ($, { kind }) => openedEntry($.model, kind),
  ChangedMunchopediaPage: ($, { page }) =>
    $.evolve({ munchopediaPage: () => page }),
})
