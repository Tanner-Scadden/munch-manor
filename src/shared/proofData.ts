import { Array, Function, Option, Schema } from 'effect'

import { DayStamp } from './dayStamp'

// The Proof Shelf's data (docs/PROGRESSION_PLAN.md, pillar B): every thing
// a player brought out of the manor, one slot per thing per difficulty,
// each holding the stamp of the first run that found it. The player scope
// (src/platform/proofScope.ts) applies the same rule here as the client
// does, so a sync Worker and a device keep the same first stamp. A slot
// names its thing and difficulty as text, so a device that does not know a
// thing yet (one added after its build) keeps the slot untouched; the
// shelf (src/features/proof/) shows what it knows.

// NOTE: Uncle Chunk's big key, hung on a difficulty's shelf once he is
// felled on it. It is no dare thing, but it is kept as one.
export const BIG_KEY = 'BigKey' as const

// NOTE: how the run that found it ended: out the front door, out the
// kitchen's back door (CHICKEN), or munched with the thing in hand. A find
// in a lost run still counts, as a lost run still pays for what it found.
export const ProofEnding = Schema.Literals(['Escaped', 'Chicken', 'Munched'])
export type ProofEnding = typeof ProofEnding.Type

const MAX_CREW_NAME = 32

const MAX_CREW = 3

// NOTE: one of the crew who came along, by the name this player saw: a
// friend in an online room, or a bot from the lobby.
export const CrewMate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(MAX_CREW_NAME)),
  isBot: Schema.Boolean,
})
export type CrewMate = typeof CrewMate.Type

// NOTE: the stamp: the wave the run ended on, the hero played, the crew
// (none alone), the UTC day (none when it was not known yet), and how it
// ended.
export const ProofStamp = Schema.Struct({
  wave: Schema.Finite,
  hero: Schema.String,
  crew: Schema.Array(CrewMate).check(Schema.isMaxLength(MAX_CREW)),
  day: Schema.NullOr(DayStamp),
  ending: ProofEnding,
})
export type ProofStamp = typeof ProofStamp.Type

export const ProofEntry = Schema.Struct({
  thing: Schema.String,
  difficulty: Schema.String,
  stamp: ProofStamp,
})
export type ProofEntry = typeof ProofEntry.Type

export const SavedProof = Schema.Array(ProofEntry)
export type SavedProof = typeof SavedProof.Type

export const noProof: SavedProof = []

const isSameSlot = (a: ProofEntry, b: ProofEntry): boolean =>
  a.thing === b.thing && a.difficulty === b.difficulty

// NOTE: a stamp from an earlier day than another's. A stamp with no day is
// never earlier, and one day is not earlier than itself: the slot keeps
// the stamp it has.
export const isEarlierStamp: {
  (than: ProofStamp): (stamp: ProofStamp) => boolean
  (stamp: ProofStamp, than: ProofStamp): boolean
} = Function.dual(
  2,
  (stamp: ProofStamp, than: ProofStamp): boolean =>
    stamp.day !== null && (than.day === null || stamp.day < than.day),
)

// NOTE: a find put on the shelf: an empty slot takes it, and a filled one
// keeps its stamp unless the find's is from an earlier day.
export const shelve: {
  (entry: ProofEntry): (proof: SavedProof) => SavedProof
  (proof: SavedProof, entry: ProofEntry): SavedProof
} = Function.dual(2, (proof: SavedProof, entry: ProofEntry): SavedProof =>
  Option.match(
    Array.findFirst(proof, kept => isSameSlot(kept, entry)),
    {
      onNone: () => Array.append(proof, entry),
      onSome: kept =>
        isEarlierStamp(entry.stamp, kept.stamp)
          ? Array.map(proof, other =>
              isSameSlot(other, entry) ? entry : other,
            )
          : proof,
    },
  ),
)

// NOTE: two shelves of the same player merged (a synced save over the
// Model's): every slot of both, each with the earlier stamp, and the
// reached shelf's (the store's, where the first device's stands) when the
// two are of one day.
export const mergeProof: {
  (reached: SavedProof): (kept: SavedProof) => SavedProof
  (kept: SavedProof, reached: SavedProof): SavedProof
} = Function.dual(2, (kept: SavedProof, reached: SavedProof): SavedProof =>
  Array.reduce(kept, reached, (shelf, entry) => shelve(shelf, entry)),
)

// NOTE: the finds on `after` that `before` does not hold as they are: new
// slots and earlier stamps, the changes sync sends up.
export const shelvedSince: {
  (after: SavedProof): (before: SavedProof) => ReadonlyArray<ProofEntry>
  (before: SavedProof, after: SavedProof): ReadonlyArray<ProofEntry>
} = Function.dual(
  2,
  (before: SavedProof, after: SavedProof): ReadonlyArray<ProofEntry> =>
    Array.filter(
      after,
      entry =>
        !Array.some(
          before,
          kept =>
            isSameSlot(kept, entry) &&
            kept.stamp.day === entry.stamp.day &&
            kept.stamp.ending === entry.stamp.ending &&
            kept.stamp.wave === entry.stamp.wave,
        ),
    ),
)
