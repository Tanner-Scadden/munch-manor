import { Array, Option, Result, Schema } from 'effect'

import type { SavedJournal } from '#shared/journalData.ts'
import type { Difficulty } from '#shared/playerData.ts'
import { BIG_KEY, type SavedProof } from '#shared/proofData.ts'
import {
  CELLAR_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '#world/level/plan.ts'

import { DareKind, HOUSE_THINGS } from './dareSchema.ts'

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

export type MilestoneFacts = Readonly<{
  journal: SavedJournal
  proof: SavedProof
  bonuses: Readonly<{ escapedOn: ReadonlyArray<Difficulty> }>
}>

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

export const newMilestonesOf = (
  facts: MilestoneFacts,
): ReadonlyArray<MilestoneId> =>
  Array.filterMap(MILESTONES, ({ id, isReached }) =>
    !Array.contains(facts.journal.milestones, id) && isReached(facts)
      ? Result.succeed(id)
      : Result.failVoid,
  )

export const maybeOpenerOf = (kind: DareKind): Option.Option<MilestoneId> =>
  Option.map(
    Array.findFirst(MILESTONES, ({ maybeThing }) =>
      Option.exists(maybeThing, thing => thing === kind),
    ),
    ({ id }) => id,
  )

export const thingsOpenedBy = (
  milestones: ReadonlyArray<string>,
): ReadonlyArray<DareKind> =>
  Array.filter(DareKind.literals, kind =>
    Option.exists(maybeOpenerOf(kind), id => Array.contains(milestones, id)),
  )

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
