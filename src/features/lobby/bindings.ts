import { DialogBlock } from '@foldkit/ui'

import { HeroPickerBlock } from '../heroes/block'
import { makeRequiredFieldBinding } from './block'
import { HERO_DIALOG_ID } from './lobby'

// NOTE: the lobby's children: the hero picker, and the Dialog it stands in
// over the lobby, focusing the hero worn as it opens. Their folds are
// chosen in composition.ts, so the Steps that call them (steps.ts) and the
// folds that call those Steps import no cycle.

export const HeroPickerBinding = makeRequiredFieldBinding(HeroPickerBlock, {
  field: 'heroPicker',
})

export const HeroDialogBinding = makeRequiredFieldBinding(DialogBlock, {
  field: 'heroDialog',
  init: {
    contextToArgs: () => [
      {
        id: HERO_DIALOG_ID,
        focusSelector: `#${HERO_DIALOG_ID} .calling-card[data-chosen='Chosen']`,
      },
    ],
  },
})
