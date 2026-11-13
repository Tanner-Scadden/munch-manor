// The dare's Schemas: the house's things the dare can ask for, where each one
// is, and the run's list, apart from the rules (src/world/dare/dare.ts) so the
// World's Schema (src/world/schema/worldSchema.ts) reads them with no cycle.

import { type Array, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { MillisNumber, Point, PositionNumber } from '../schema/wireNumber'

// NOTE: every thing in the house's pool. The list is only these: Uncle
// Chunk is no thing on it, just the fight once it is done. The first six
// are every player's from the first run; the last four each join a
// player's pool once a milestone opens it (src/world/dare/milestones.ts).
// New things go at the end, so a pool's order, and so what a seed rolls
// from the first six, never moves.
export const DareKind = Schema.Literals([
  'SilverSpoon',
  'FamilyPortrait',
  'GuestBookPage',
  'GrandmasRecipe',
  'MusicBox',
  'ButlersBell',
  'NapkinRing',
  'DareNote',
  'FalseTeeth',
  'Invitation',
])
export type DareKind = typeof DareKind.Type

// NOTE: the things every run may roll, from the first.
export const HOUSE_THINGS: Array.NonEmptyReadonlyArray<DareKind> = [
  'SilverSpoon',
  'FamilyPortrait',
  'GuestBookPage',
  'GrandmasRecipe',
  'MusicBox',
  'ButlersBell',
]

// NOTE: where one thing is. Hidden lies at a spot in the room that holds
// it, out of reach while the room's boards stand, with the work the crew
// has put into finding it (src/world/dare/finds.ts: each room finds its
// thing its own way, a rummage, a hollow book, the dumbwaiter, or a walk
// onto it). A thing is Found, by the seat's slot that found it, for the
// whole crew.
export const DareThingState = defineTaggedUnion({
  Hidden: { x: PositionNumber, y: PositionNumber, workedMs: MillisNumber },
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
// Uncle Chunk comes to the front door and fights; KeyFlying the moment he
// falls, his big key in the air from where he fell to the front door's
// lock; Open once it lands and the door swings open. Who has stepped out
// through it is each seat's own Life.Out.
export const Finale = defineTaggedUnion({
  Hunting: {},
  Summoned: {},
  KeyFlying: {
    from: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Open: {},
})
export type Finale = typeof Finale.Type

// NOTE: the run's dare: its own generator, salted apart from the run's so
// rolling the list moves nothing else, the list in the order it was
// rolled (empty in Endless), and where the finale stands.
export const Dare = Schema.Struct({
  rngState: Schema.Finite,
  list: Schema.Array(DareKind),
  finale: Finale,
})
export type Dare = typeof Dare.Type
