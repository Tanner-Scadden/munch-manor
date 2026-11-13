import { Array, Function, Schema } from 'effect'

// The Dare Journal's data (docs/PROGRESSION_PLAN.md, pillar B): what a
// player has done across runs that the journal's pages and the milestones
// read (src/world/dare/milestones.ts). Sets of ids that only ever grow, and
// one count that only ever adds, so two devices offline at once both keep
// what they did. Ids are text, so a device that does not know one yet (a
// milestone, room, or hero added after its build) keeps it untouched. Shared
// with the sync Worker, like the scope (src/platform/playerScope.ts), so it
// imports only `effect`.

const MAX_IDS = 64

const Ids = Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_IDS))

// NOTE: the milestones reached, the rooms opened and the rooms a thing was
// found in (by room id: Kitchen, Parlour, Library, Cellar), the heroes a
// run was played as (by calling), and every dare thing found in all, a
// find in a lost run counted.
export const SavedJournal = Schema.Struct({
  milestones: Ids,
  roomsOpened: Ids,
  roomsFoundIn: Ids,
  heroesPlayed: Ids,
  thingsFound: Schema.Finite,
})
export type SavedJournal = typeof SavedJournal.Type

export const noJournal: SavedJournal = {
  milestones: [],
  roomsOpened: [],
  roomsFoundIn: [],
  heroesPlayed: [],
  thingsFound: 0,
}

const SET_FIELDS = [
  'milestones',
  'roomsOpened',
  'roomsFoundIn',
  'heroesPlayed',
] as const

type SetField = (typeof SET_FIELDS)[number]

const unionOf = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): ReadonlyArray<string> => Array.take(Array.union(a, b), MAX_IDS)

// NOTE: two journals of the same player merged (a synced save over the
// Model's): every id of both, and the larger count, since the store's
// count already holds every device's runs that reached it.
export const mergeJournal: {
  (reached: SavedJournal): (kept: SavedJournal) => SavedJournal
  (kept: SavedJournal, reached: SavedJournal): SavedJournal
} = Function.dual(
  2,
  (kept: SavedJournal, reached: SavedJournal): SavedJournal => ({
    milestones: unionOf(reached.milestones, kept.milestones),
    roomsOpened: unionOf(reached.roomsOpened, kept.roomsOpened),
    roomsFoundIn: unionOf(reached.roomsFoundIn, kept.roomsFoundIn),
    heroesPlayed: unionOf(reached.heroesPlayed, kept.heroesPlayed),
    thingsFound: Math.max(kept.thingsFound, reached.thingsFound),
  }),
)

// NOTE: what `after` holds that `before` does not, as an increment (its
// count what was added, its sets the new ids), or nothing at all when the
// two are the same.
export const journalAdded: {
  (after: SavedJournal): (before: SavedJournal) => ReadonlyArray<SavedJournal>
  (before: SavedJournal, after: SavedJournal): ReadonlyArray<SavedJournal>
} = Function.dual(
  2,
  (before: SavedJournal, after: SavedJournal): ReadonlyArray<SavedJournal> => {
    const newIn = (field: SetField): ReadonlyArray<string> =>
      Array.filter(after[field], id => !Array.contains(before[field], id))
    const added: SavedJournal = {
      milestones: newIn('milestones'),
      roomsOpened: newIn('roomsOpened'),
      roomsFoundIn: newIn('roomsFoundIn'),
      heroesPlayed: newIn('heroesPlayed'),
      thingsFound: Math.max(0, after.thingsFound - before.thingsFound),
    }
    return added.thingsFound > 0 ||
      Array.some(SET_FIELDS, field =>
        Array.isReadonlyArrayNonEmpty(added[field]),
      )
      ? [added]
      : []
  },
)

// NOTE: an increment added to a journal: the scope's rule and the client's.
export const addToJournal: {
  (added: SavedJournal): (journal: SavedJournal) => SavedJournal
  (journal: SavedJournal, added: SavedJournal): SavedJournal
} = Function.dual(
  2,
  (journal: SavedJournal, added: SavedJournal): SavedJournal => ({
    milestones: unionOf(journal.milestones, added.milestones),
    roomsOpened: unionOf(journal.roomsOpened, added.roomsOpened),
    roomsFoundIn: unionOf(journal.roomsFoundIn, added.roomsFoundIn),
    heroesPlayed: unionOf(journal.heroesPlayed, added.heroesPlayed),
    thingsFound: journal.thingsFound + added.thingsFound,
  }),
)
