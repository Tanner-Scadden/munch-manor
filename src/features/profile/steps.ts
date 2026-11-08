import { Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { makeStep } from './block'
import type { LookPart } from './blocks/look/lookSchema'
import type { ClosetCueKind, ProfileFx } from './blocks/look/model'
import { OutMessage } from './message'
import type { Model, ProfileTab } from './model'
import { cleanName } from './profile'

// NOTE: the Profile's own transitions, shared by its update, its
// InMessages, and its children's folds (FOLDKIT.md, "File organization").

// NOTE: plays an effect in the Profile. The count moves on every time, so
// the view swaps the element and the CSS animation starts over.
export const withFx: {
  (fx: ProfileFx): (model: Model) => Model
  (model: Model, fx: ProfileFx): Model
} = Function.dual(2, (model: Model, fx: ProfileFx): Model =>
  modifyFields(model, { fx: () => fx, fxCount: count => count + 1 }),
)

// NOTE: the try-on ends: the figure goes back to what is worn.
export const withoutPreview = (model: Model): Model =>
  modifyFields(model, { maybePreview: () => Option.none() })

export const withCue: {
  (part: LookPart, value: string, kind: ClosetCueKind): (model: Model) => Model
  (model: Model, part: LookPart, value: string, kind: ClosetCueKind): Model
} = Function.dual(
  4,
  (model: Model, part: LookPart, value: string, kind: ClosetCueKind): Model =>
    modifyFields(model, {
      closetCue: cue => ({ part, value, kind, count: cue.count + 1 }),
    }),
)

// NOTE: the name as it is kept: the draft cleaned.
const keptName = (model: Model): string => cleanName(model.nameDraft)

const withNameKept = (model: Model): Model =>
  modifyFields(model, { nameDraft: () => keptName(model) })

export const showTab: {
  (tab: ProfileTab): (model: Model) => Model
  (model: Model, tab: ProfileTab): Model
} = Function.dual(2, (model: Model, tab: ProfileTab): Model =>
  modifyFields(model, {
    tutorialReset: () => 'Idle',
    tab: () => tab,
    fx: () => 'Still',
    maybePreview: () => Option.none(),
  }),
)

// NOTE: the name is kept, and so saved and synced by the root, when the
// player is done typing: leaving the field, another tab, or closing the
// Profile (Enter is SubmittedName, with its pop). Saving on every key would
// send a sync mutation per letter.
export const keepName = makeStep(model => ({
  model: withNameKept(model),
  outMessage: OutMessage.KeptName({ name: keptName(model) }),
}))

export const submitName = makeStep(model => ({
  model: withNameKept(model),
  outMessage: OutMessage.SubmittedName({ name: keptName(model) }),
}))

// NOTE: another tab keeps the name first, so the root learns both at once.
export const switchTab = (tab: ProfileTab) =>
  makeStep(model =>
    tab === model.tab
      ? { model }
      : {
          model: showTab(withNameKept(model), tab),
          outMessage: OutMessage.SwitchedTab({ tab, name: keptName(model) }),
        },
  )
