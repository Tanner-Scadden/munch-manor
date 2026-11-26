import { Function, Option, Record, Schema } from 'effect'

export const MasterySkin = Schema.Literals(['Gilded', 'Diamond'])
export type MasterySkin = typeof MasterySkin.Type

type Counts = Readonly<Record<string, number>>

export const SavedMastery = Schema.Struct({
  heroes: Schema.Record(Schema.String, Schema.Finite),
  guns: Schema.Record(Schema.String, Schema.Finite),
})
export type SavedMastery = typeof SavedMastery.Type

export const noMastery: SavedMastery = { heroes: {}, guns: {} }

const countIn = (counts: Counts, key: string): number =>
  Option.getOrElse(Record.get(counts, key), () => 0)

const mergeCounts = (kept: Counts, reached: Counts): Counts =>
  Record.union(kept, reached, (a, b) => Math.max(a, b))

const addCounts = (counts: Counts, added: Counts): Counts =>
  Record.union(counts, added, (a, b) => a + b)

const countsAdded = (before: Counts, after: Counts): Counts =>
  Record.filter(
    Record.map(after, (count, key) => count - countIn(before, key)),
    count => count > 0,
  )

export const mergeMastery: {
  (reached: SavedMastery): (kept: SavedMastery) => SavedMastery
  (kept: SavedMastery, reached: SavedMastery): SavedMastery
} = Function.dual(
  2,
  (kept: SavedMastery, reached: SavedMastery): SavedMastery => ({
    heroes: mergeCounts(kept.heroes, reached.heroes),
    guns: mergeCounts(kept.guns, reached.guns),
  }),
)

export const masteryAdded: {
  (after: SavedMastery): (before: SavedMastery) => ReadonlyArray<SavedMastery>
  (before: SavedMastery, after: SavedMastery): ReadonlyArray<SavedMastery>
} = Function.dual(
  2,
  (before: SavedMastery, after: SavedMastery): ReadonlyArray<SavedMastery> => {
    const added: SavedMastery = {
      heroes: countsAdded(before.heroes, after.heroes),
      guns: countsAdded(before.guns, after.guns),
    }
    return Record.isEmptyRecord(added.heroes) &&
      Record.isEmptyRecord(added.guns)
      ? []
      : [added]
  },
)

export const addToMastery: {
  (added: SavedMastery): (mastery: SavedMastery) => SavedMastery
  (mastery: SavedMastery, added: SavedMastery): SavedMastery
} = Function.dual(
  2,
  (mastery: SavedMastery, added: SavedMastery): SavedMastery => ({
    heroes: addCounts(mastery.heroes, added.heroes),
    guns: addCounts(mastery.guns, added.guns),
  }),
)

export const heroPointsOf: {
  (calling: string): (mastery: SavedMastery) => number
  (mastery: SavedMastery, calling: string): number
} = Function.dual(2, (mastery: SavedMastery, calling: string): number =>
  countIn(mastery.heroes, calling),
)

export const gunKillsOf: {
  (kind: string): (mastery: SavedMastery) => number
  (mastery: SavedMastery, kind: string): number
} = Function.dual(2, (mastery: SavedMastery, kind: string): number =>
  countIn(mastery.guns, kind),
)
