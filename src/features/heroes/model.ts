import { Option, Schema } from 'effect'

import { Calling } from '../../shared/playerData'

// NOTE: whether a screen is up: the hero picker (a parent shows it in its
// own frame, the solo lobby's Dialog or co-op's lobby overlay), and the solo
// lobby that holds it.
export const OpenStatus = Schema.Literals(['Closed', 'Open'])
export type OpenStatus = typeof OpenStatus.Type

// NOTE: the picker's own state: up or not, and the hero for sale being tried
// on (its BUY pill buys it), never saved. Which hero is worn, who owns what,
// and the Bones are its parent's: the picker reads them as view inputs and
// asks about a tap through its OutMessages.
export const Model = Schema.Struct({
  status: OpenStatus,
  maybeTrying: Schema.Option(Calling),
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  status: 'Closed',
  maybeTrying: Option.none(),
}

// NOTE: a read for the parents, so they never read the picker's fields.
export const isPickerOpen = (model: Model): boolean => model.status === 'Open'
