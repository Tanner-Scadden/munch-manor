import { Array, Effect, Option, Schema } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ProfileBlock } from './block'
import { LookPart } from './blocks/look/lookSchema'
import { ProfileComposition } from './composition'
import type { LookOutcome } from './inMessage'
import { Message } from './message'
import type { Model } from './model'
import { keepName, showTab, withCue, withFx, withoutPreview } from './steps'

// NOTE: a look just bought: its BUY pill is gone, so focus goes to its
// option.
export const FocusLookOption = ProfileBlock.makeCommand('FocusLookOption', {
  args: { part: LookPart, value: Schema.String },
  messages: [Message.CompletedFocusLookOption],
  handler: function* () {
    return ({ part, value }) =>
      Dom.focus(`[data-look-option="${part}.${value}"]`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusLookOption()),
      )
  },
})

type OutcomeShown = (model: Model, part: LookPart, value: string) => Model

// NOTE: what each outcome of a Look tab pick plays. A pick that is worn,
// tried on, or refused ends an earlier try-on; too few Bones keeps it, so
// BUY stays for when there are enough.
const OUTCOMES: Readonly<Record<LookOutcome, OutcomeShown>> = {
  Stay: model => withoutPreview(model),
  Wear: model => withFx(withoutPreview(model), 'Poof'),
  Preview: (model, part, value) =>
    withFx(
      modifyFields(model, {
        maybePreview: () => Option.some({ part, value }),
      }),
      'Poof',
    ),
  Locked: (model, part, value) =>
    withCue(withoutPreview(model), part, value, 'Short'),
  Bought: (model, part, value) =>
    withFx(withCue(withoutPreview(model), part, value, 'Bought'), 'Poof'),
  Short: (model, part, value) => withCue(model, part, value, 'Short'),
}

// NOTE: the root's requests. Opening readies the tab and the name to edit;
// the Dialog itself is the root's (ProfileDialogBinding).
export const inMessageUpdate = ProfileComposition.makeInMessageUpdate({
  RequestedOpen: (model, { tab, name }) => ({
    model: modifyFields(showTab(model, tab), { nameDraft: () => name }),
  }),

  RequestedKeepName: keepName,

  InformedOfRolledName: (model, { name }) => ({
    model: withFx(modifyFields(model, { nameDraft: () => name }), 'Spin'),
  }),

  InformedOfLookOutcome: (model, { part, value, outcome }) => ({
    model: OUTCOMES[outcome](model, part, value),
    commands: Array.filter(
      [FocusLookOption({ part, value })],
      () => outcome === 'Bought',
    ),
  }),
})
