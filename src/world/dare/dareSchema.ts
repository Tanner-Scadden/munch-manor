// The dare's Schemas: the house's things the dare can ask for, where each one
// is, and the run's list, apart from the rules (src/world/dare/dare.ts) so the
// World's Schema (src/world/schema/worldSchema.ts) reads them with no cycle.

import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { MillisNumber, PositionNumber } from '../schema/wireNumber'

// NOTE: every thing in the house's pool, Uncle Chunk's party hat too, which
// is never rolled: it closes every list.
export const DareKind = Schema.Literals([
  'SilverSpoon',
  'FamilyPortrait',
  'GuestBookPage',
  'GrandmasRecipe',
  'MusicBox',
  'ButlersBell',
  'PartyHat',
])
export type DareKind = typeof DareKind.Type

// NOTE: where one thing is. Hidden lies at a spot in the room that holds
// it, unseen until a player walks close, and out of reach while the room's
// boards stand; Dropped lies where Uncle Chunk fell (his hat). A thing is
// Found the moment a standing player walks onto it, by that seat's slot,
// for the whole crew.
export const DareThingState = defineTaggedUnion({
  Hidden: { x: PositionNumber, y: PositionNumber },
  Dropped: { x: PositionNumber, y: PositionNumber },
  Found: { slot: Schema.Finite },
})
export type DareThingState = typeof DareThingState.Type

export const DareThing = Schema.Struct({
  id: Schema.Finite,
  kind: DareKind,
  state: DareThingState,
})
export type DareThing = typeof DareThing.Type

// NOTE: where the finale stands (src/world/dare/finale.ts). Hunting while
// the list is not done (and always in Endless); Summoned once it is, while
// Uncle Chunk comes to the front door, fights, and leaves his hat on the
// floor; Unlocking once a player takes the hat, the front door's clock
// running down in each wave; Open once it swings open. Who has stepped out
// through it is each seat's own Life.Out.
export const Finale = defineTaggedUnion({
  Hunting: {},
  Summoned: {},
  Unlocking: { remainingMs: MillisNumber, durationMs: MillisNumber },
  Open: {},
})
export type Finale = typeof Finale.Type

// NOTE: the run's dare: its own generator, salted apart from the run's so
// rolling the list moves nothing else, the list in the order it was
// rolled, without the hat, which always closes it (empty in Endless), and
// where the finale stands.
export const Dare = Schema.Struct({
  rngState: Schema.Finite,
  list: Schema.Array(DareKind),
  finale: Finale,
})
export type Dare = typeof Dare.Type
