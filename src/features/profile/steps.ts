import { Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { LookPart } from '../../domain/looks'
import { cleanName } from '../../domain/playerName'
import type { ClosetCueKind, ProfileFx } from './blocks/look/model'
import type { LookOutcome, Model, ProfileTab } from './model'

// NOTE: the Profile panel's own transitions on its state, the root's
// `profile` field, for the root's Steps (src/app/update/profile.ts).

// NOTE: plays an effect in the Profile. The count moves on every time, so
// the view swaps the element and the CSS animation starts over.
export const withFx: {
  (fx: ProfileFx): (model: Model) => Model
  (model: Model, fx: ProfileFx): Model
} = Function.dual(2, (model: Model, fx: ProfileFx): Model =>
  UiStruct.evolve(model, { fx: () => fx, fxCount: count => count + 1 }),
)

// NOTE: the try-on ends: the figure goes back to what is worn.
export const withoutPreview = (model: Model): Model =>
  UiStruct.evolve(model, { maybePreview: () => Option.none() })

const withCue: {
  (part: LookPart, value: string, kind: ClosetCueKind): (model: Model) => Model
  (model: Model, part: LookPart, value: string, kind: ClosetCueKind): Model
} = Function.dual(
  4,
  (model: Model, part: LookPart, value: string, kind: ClosetCueKind): Model =>
    UiStruct.evolve(model, {
      closetCue: cue => ({ part, value, kind, count: cue.count + 1 }),
    }),
)

// NOTE: the name as it is kept: the draft cleaned.
export const keptName = (model: Model): string => cleanName(model.nameDraft)

export const withNameKept = (model: Model): Model =>
  UiStruct.evolve(model, { nameDraft: () => keptName(model) })

export const showTab: {
  (tab: ProfileTab): (model: Model) => Model
  (model: Model, tab: ProfileTab): Model
} = Function.dual(2, (model: Model, tab: ProfileTab): Model =>
  UiStruct.evolve(model, {
    tutorialReset: () => 'Idle',
    tab: () => tab,
    fx: () => 'Still',
    maybePreview: () => Option.none(),
  }),
)

// NOTE: the Profile as it opens on a tab, with the name kept to edit.
export const opened: {
  (tab: ProfileTab, name: string): (model: Model) => Model
  (model: Model, tab: ProfileTab, name: string): Model
} = Function.dual(3, (model: Model, tab: ProfileTab, name: string): Model =>
  UiStruct.evolve(showTab(model, tab), { nameDraft: () => name }),
)

// NOTE: a name kept on another device replaces the draft unless the player
// has typed their own over it here. A stale draft would be kept again on
// close and undo the other device's name.
export const withSyncedName: {
  (was: string, name: string): (model: Model) => Model
  (model: Model, was: string, name: string): Model
} = Function.dual(3, (model: Model, was: string, name: string): Model =>
  cleanName(model.nameDraft) === was
    ? UiStruct.evolve(model, { nameDraft: () => name })
    : model,
)

type OutcomeShown = (model: Model, part: LookPart, value: string) => Model

// NOTE: what each outcome of a Look tab pick plays. A pick that is worn,
// tried on, or refused ends an earlier try-on; too few Bones keeps it, so
// BUY stays for when there are enough.
const OUTCOMES: Readonly<Record<LookOutcome, OutcomeShown>> = {
  Stay: model => withoutPreview(model),
  Wear: model => withFx(withoutPreview(model), 'Poof'),
  Preview: (model, part, value) =>
    withFx(
      UiStruct.evolve(model, {
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

export const withOutcome: {
  (part: LookPart, value: string, outcome: LookOutcome): (model: Model) => Model
  (model: Model, part: LookPart, value: string, outcome: LookOutcome): Model
} = Function.dual(
  4,
  (model: Model, part: LookPart, value: string, outcome: LookOutcome): Model =>
    OUTCOMES[outcome](model, part, value),
)
