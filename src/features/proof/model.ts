import { Option, Schema } from 'effect'

import { SavedDareMarks } from '../../shared/dareMarkData'
import { DayStamp } from '../../shared/dayStamp'
import { SavedProof } from '../../shared/proofData'
import { ShelfSpot, ShelfThing } from './proof'

export const ProofShelfProps = Schema.Struct({
  proof: SavedProof,
  things: Schema.NonEmptyArray(ShelfThing),
  stampedDays: Schema.Array(DayStamp),
  maybeToday: Schema.Option(DayStamp),
  fresh: Schema.Array(Schema.String),
  dareMarks: SavedDareMarks,
})
export type ProofShelfProps = typeof ProofShelfProps.Type

export const Model = Schema.Struct({
  maybePicked: Schema.Option(ShelfSpot),
})
export type Model = typeof Model.Type

export const initialModel: Model = { maybePicked: Option.none() }
