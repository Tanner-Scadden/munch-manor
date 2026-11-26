import { Array, Function, Option, Schema } from 'effect'

import { DayStamp } from './dayStamp'

export const BIG_KEY = 'BigKey' as const

export const ProofEnding = Schema.Literals(['Escaped', 'Chicken', 'Munched'])
export type ProofEnding = typeof ProofEnding.Type

const MAX_CREW_NAME = 32

const MAX_CREW = 3

export const CrewMate = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(MAX_CREW_NAME)),
  isBot: Schema.Boolean,
})
export type CrewMate = typeof CrewMate.Type

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

export const isEarlierStamp: {
  (than: ProofStamp): (stamp: ProofStamp) => boolean
  (stamp: ProofStamp, than: ProofStamp): boolean
} = Function.dual(
  2,
  (stamp: ProofStamp, than: ProofStamp): boolean =>
    stamp.day !== null && (than.day === null || stamp.day < than.day),
)

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

export const mergeProof: {
  (reached: SavedProof): (kept: SavedProof) => SavedProof
  (kept: SavedProof, reached: SavedProof): SavedProof
} = Function.dual(2, (kept: SavedProof, reached: SavedProof): SavedProof =>
  Array.reduce(kept, reached, (shelf, entry) => shelve(shelf, entry)),
)

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
