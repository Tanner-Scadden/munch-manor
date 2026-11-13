import { Array, Function, Option, Record, Schema } from 'effect'

// Hero and gun mastery's data (docs/PROGRESSION_PLAN.md, pillar D): the
// mastery points each hero's runs have earned, by calling, and the kills
// each gun has made, by weapon kind, across every run. Both only ever add,
// so two devices that play offline at once both keep what they did. Keys
// are text, so a device that does not know a hero or a gun yet keeps its
// count untouched. What a level or a count opens is the client's
// (src/domain/mastery.ts). Shared with the sync Worker, like the scope
// (src/platform/masteryScope.ts), so it imports only `effect`.

// NOTE: a gun's mastery skin (src/domain/mastery.ts): Gilded at 1,000
// lifetime kills with that gun, Diamond at 2,500. Worn by that gun in the
// player's own hands over the look's skin; never part of the look.
export const MasterySkin = Schema.Literals(['Gilded', 'Diamond'])
export type MasterySkin = typeof MasterySkin.Type

// NOTE: a count by key, a hero's points or a gun's kills.
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

// NOTE: two masteries of the same player merged (a synced save over the
// Model's): the larger count of each, since the store's already holds every
// device's runs that reached it.
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

// NOTE: what `after` holds past `before`, as an increment, or nothing at
// all when the two are the same.
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

// NOTE: an increment added to a mastery: the scope's rule and the client's.
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

// NOTE: a hero's mastery points, or a gun's kills, 0 for none yet.
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

// NOTE: the rows the scope's two tables hold, one per hero and one per gun.
export const masteryRowsOf = (
  counts: Counts,
): ReadonlyArray<readonly [string, number]> =>
  Array.filter(Record.toEntries(counts), ([, count]) => count > 0)
