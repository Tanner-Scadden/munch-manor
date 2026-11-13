import { type Array, type Option, Schema } from 'effect'
import { Block } from 'foldkit'
import type { Html } from 'foldkit/html'

import type { SavedDareMarks } from '../../shared/dareMarkData'
import type { DayStamp } from '../../shared/dayStamp'
import type { SavedProof } from '../../shared/proofData'
import { InMessage } from './inMessage'
import { Message } from './message'
import { Model } from './model'
import type { ShelfThing } from './proof'

// NOTE: what the root hands the shelf's view: the shelf itself (saved and
// synced), the things along each row (the house's and those opened), the days of missions done and today (the calendar), the slots
// new since the shelf last opened (their NEW pips), the dare ladder's best
// mark on each difficulty (a seal on its row's trim), and the menu panel's
// Done, a function so it keeps sending the root's Message.
export type ViewInputs = Readonly<{
  proof: SavedProof
  things: Array.NonEmptyReadonlyArray<ShelfThing>
  stampedDays: ReadonlyArray<DayStamp>
  maybeToday: Option.Option<DayStamp>
  fresh: ReadonlyArray<string>
  dareMarks: SavedDareMarks
  doneButton: () => Html
}>

// NOTE: the Proof Shelf's public contract. The root opens it in its menu
// panel and keeps what is on it; the shelf picks a slot and walks its slots
// on its own.
const ProofShelfKey = Symbol('ProofShelf')
export const ProofShelfBlock = Block.make('ProofShelf', {
  key: ProofShelfKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model,
  Message,
  InMessage,
})

export const { makeComposition } = ProofShelfBlock
