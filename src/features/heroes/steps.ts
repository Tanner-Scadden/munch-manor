import { Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from './model'

// NOTE: the picker's own transitions, shared by its update and its
// InMessages.

export const opened = (model: Model): Model =>
  modifyFields(model, {
    status: () => 'Open',
    maybeTrying: () => Option.none(),
  })

export const closed = (model: Model): Model =>
  modifyFields(model, {
    status: () => 'Closed',
    maybeTrying: () => Option.none(),
  })
