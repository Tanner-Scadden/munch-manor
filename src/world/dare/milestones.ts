import { Array, Option, Result, Schema } from 'effect'

import type { SavedJournal } from '../../shared/journalData'
import type { Difficulty } from '../../shared/playerData'
import { BIG_KEY, type SavedProof } from '../../shared/proofData'
import {
  CELLAR_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../level/plan'
import { DareKind, HOUSE_THINGS } from './dareSchema'

// The milestones (docs/PROGRESSION_PLAN.md, pillar B; "Unlocks gate only
// new content"): what a player has done across runs, each opening
// something new. Every one opens a page of the Dare Journal's story, in
// this table's order, and four of them open a new thing for the dare's
// list. A milestone is read off the saved journal, the shelf, and the
// escapes, as a run pays out (src/domain/journal.ts), and kept for good in
// the saved journal (src/shared/journalData.ts). The World reads only the
// things a player's milestones open, handed to the list's roll as the
// run's settings (`rollDare` in src/world/dare/dare.ts), so a run is the
// same from its seed and its settings alone.

export const MilestoneId = Schema.Literals([
  'FirstFind',
  'FirstEscape',
  'EveryRoomOpened',
  'ThingInEveryRoom',
  'TenThings',
  'EscapeDoubleDare',
  'ChunkTripleDare',
  'EscapeTripleDogDare',
])
export type MilestoneId = typeof MilestoneId.Type

// NOTE: what a milestone reads: a saved player's journal, shelf, and the
// difficulties escaped on, or the client's Model, which holds the same.
export type MilestoneFacts = Readonly<{
  journal: SavedJournal
  proof: SavedProof
  bonuses: Readonly<{ escapedOn: ReadonlyArray<Difficulty> }>
}>

// NOTE: the rooms that hold the list's things: the kitchen and the three
// that roll into the house's slots. The dining room holds none.
export const THING_ROOMS: Array.NonEmptyReadonlyArray<string> = [
  KITCHEN_ROOM_ID,
  PARLOUR_ROOM_ID,
  LIBRARY_ROOM_ID,
  CELLAR_ROOM_ID,
]

const TEN_THINGS = 10

const hasEvery = (
  held: ReadonlyArray<string>,
  wanted: ReadonlyArray<string>,
): boolean => Array.every(wanted, id => Array.contains(held, id))

const isEscapedOnAny = (
  facts: MilestoneFacts,
  difficulties: ReadonlyArray<Difficulty>,
): boolean =>
  Array.some(facts.bonuses.escapedOn, difficulty =>
    Array.contains(difficulties, difficulty),
  )

export type Milestone = Readonly<{
  id: MilestoneId
  maybeThing: Option.Option<DareKind>
  isReached: (facts: MilestoneFacts) => boolean
}>

// NOTE: the table, in the story's order. A harder escape counts for an
// easier one's milestone, and Uncle Chunk felled on Triple Dog Dare counts
// for Triple Dare's.
export const MILESTONES: Array.NonEmptyReadonlyArray<Milestone> = [
  {
    id: 'FirstFind',
    maybeThing: Option.none(),
    isReached: facts => facts.journal.thingsFound >= 1,
  },
  {
    id: 'FirstEscape',
    maybeThing: Option.some('NapkinRing'),
    isReached: facts => Array.isReadonlyArrayNonEmpty(facts.bonuses.escapedOn),
  },
  {
    id: 'EveryRoomOpened',
    maybeThing: Option.none(),
    isReached: facts => hasEvery(facts.journal.roomsOpened, THING_ROOMS),
  },
  {
    id: 'ThingInEveryRoom',
    maybeThing: Option.some('DareNote'),
    isReached: facts => hasEvery(facts.journal.roomsFoundIn, THING_ROOMS),
  },
  {
    id: 'TenThings',
    maybeThing: Option.some('Invitation'),
    isReached: facts => facts.journal.thingsFound >= TEN_THINGS,
  },
  {
    id: 'EscapeDoubleDare',
    maybeThing: Option.none(),
    isReached: facts => isEscapedOnAny(facts, ['Normal', 'Hard', 'Nightmare']),
  },
  {
    id: 'ChunkTripleDare',
    maybeThing: Option.some('FalseTeeth'),
    isReached: facts =>
      Array.some(
        facts.proof,
        entry =>
          entry.thing === BIG_KEY &&
          (entry.difficulty === 'Hard' || entry.difficulty === 'Nightmare'),
      ),
  },
  {
    id: 'EscapeTripleDogDare',
    maybeThing: Option.none(),
    isReached: facts => isEscapedOnAny(facts, ['Nightmare']),
  },
]

export const milestoneOf = (id: MilestoneId): Milestone =>
  Option.getOrElse(
    Array.findFirst(MILESTONES, milestone => milestone.id === id),
    () => Array.headNonEmpty(MILESTONES),
  )

// NOTE: the milestones the facts meet that the journal does not hold yet,
// in the table's order.
export const newMilestonesOf = (
  facts: MilestoneFacts,
): ReadonlyArray<MilestoneId> =>
  Array.filterMap(MILESTONES, ({ id, isReached }) =>
    !Array.contains(facts.journal.milestones, id) && isReached(facts)
      ? Result.succeed(id)
      : Result.failVoid,
  )

// NOTE: the milestone that opens a thing, if one does: none for the house's
// first six.
export const maybeOpenerOf = (kind: DareKind): Option.Option<MilestoneId> =>
  Option.map(
    Array.findFirst(MILESTONES, ({ maybeThing }) =>
      Option.exists(maybeThing, thing => thing === kind),
    ),
    ({ id }) => id,
  )

// NOTE: the things a player's reached milestones open, in the pool's
// order, from the saved ids (an id this build does not know opens
// nothing).
export const thingsOpenedBy = (
  milestones: ReadonlyArray<string>,
): ReadonlyArray<DareKind> =>
  Array.filter(DareKind.literals, kind =>
    Option.exists(maybeOpenerOf(kind), id => Array.contains(milestones, id)),
  )

// NOTE: the pool a list rolls from: the house's six, then the opened
// things in the Schema's order. With none opened it is the six alone, so
// a seed rolls the same list it always did.
export const dareThingPool = (
  opened: ReadonlyArray<DareKind>,
): Array.NonEmptyReadonlyArray<DareKind> =>
  Array.appendAll(
    HOUSE_THINGS,
    Array.filter(
      DareKind.literals,
      kind =>
        !Array.contains(HOUSE_THINGS, kind) && Array.contains(opened, kind),
    ),
  )
