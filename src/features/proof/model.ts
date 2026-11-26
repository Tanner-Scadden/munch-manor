import { Option, Schema } from 'effect'

import { SavedDareMarks } from '#shared/records/dareMarkData.ts'
import { DayStamp } from '#shared/records/dayStamp.ts'
import { SavedProof } from '#shared/records/proofData.ts'

import { ShelfSpot, ShelfThing } from './proof.ts'

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
