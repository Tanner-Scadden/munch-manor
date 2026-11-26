import { Option, Schema } from 'effect'

import { SavedDareMarks } from '../../shared/dareMarkData'
import { DayStamp } from '../../shared/dayStamp'
import { SavedProof } from '../../shared/proofData'
import { ShelfSpot, ShelfThing } from './proof'

// NOTE: what the root hands the shelf: the shelf itself (saved and
// synced), the things along each row (the house's and those opened), the
// days of missions done and today (the calendar), the slots new since the
// shelf last opened (their NEW pips), and the dare ladder's best mark on
// each difficulty (a seal on its row's trim).
export const ProofShelfProps = Schema.Struct({
  proof: SavedProof,
  things: Schema.NonEmptyArray(ShelfThing),
  stampedDays: Schema.Array(DayStamp),
  maybeToday: Schema.Option(DayStamp),
  fresh: Schema.Array(Schema.String),
  dareMarks: SavedDareMarks,
})
export type ProofShelfProps = typeof ProofShelfProps.Type

// NOTE: the shelf's own state, never saved: the slot picked, whose stamp
// shows under the shelf. It starts with nothing picked each time the panel
// mounts the shelf.
export const Model = Schema.Struct({
  maybePicked: Schema.Option(ShelfSpot),
})
export type Model = typeof Model.Type

export const initialModel: Model = { maybePicked: Option.none() }
