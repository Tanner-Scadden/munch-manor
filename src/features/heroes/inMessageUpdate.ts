import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { HeroPickerComposition } from './composition'
import { PickOutcome } from './inMessage'
import { OutMessage } from './message'
import { type Model, isPickerOpen } from './model'
import { closed, opened } from './steps'

// NOTE: the keys that close an open picker: Escape, and Y, the key that
// opened it.
const CLOSING_KEYS: ReadonlyArray<string> = ['Escape', 'KeyY']

const shown = (model: Model, outcome: PickOutcome): Model =>
  PickOutcome.match(outcome, {
    Worn: () => closed(model),
    TriedOn: ({ calling }) =>
      modifyFields(model, { maybeTrying: () => Option.some(calling) }),
    TryOnEnded: () => modifyFields(model, { maybeTrying: () => Option.none() }),
    Unchanged: () => model,
  })

export const inMessageUpdate = HeroPickerComposition.makeInMessageUpdate({
  RequestedOpen: model => ({ model: opened(model) }),

  RequestedClose: model => ({ model: closed(model) }),

  RequestedPressKey: (model, { code }) =>
    isPickerOpen(model) && Array.contains(CLOSING_KEYS, code)
      ? { model: closed(model), outMessage: OutMessage.Closed() }
      : { model },

  InformedOfOutcome: (model, { outcome }) => ({
    model: isPickerOpen(model) ? shown(model, outcome) : model,
  }),
})
