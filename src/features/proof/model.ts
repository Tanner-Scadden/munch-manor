import { Option, Schema } from 'effect'

import { ShelfSpot } from './proof'

// NOTE: the shelf's own state, never saved: the slot picked, whose stamp
// shows under the shelf. What the shelf holds is the root's (`proof`, saved
// and synced), read as a view input.
export const Model = Schema.Struct({
  maybePicked: Schema.Option(ShelfSpot),
})
export type Model = typeof Model.Type

export const initialModel: Model = { maybePicked: Option.none() }
