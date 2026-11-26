import { Array, Function, Schema } from 'effect'

const MAX_IDS = 64

const Ids = Schema.Array(Schema.String).check(Schema.isMaxLength(MAX_IDS))

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
