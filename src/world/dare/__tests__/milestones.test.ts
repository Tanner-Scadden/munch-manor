import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { type SavedJournal, noJournal } from '../../../shared/journalData'
import { BIG_KEY, type ProofEntry } from '../../../shared/proofData'
import {
  CELLAR_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../../level/plan'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomSettings,
  startRoomWorld,
} from '../../net/roomWorld'
import { type DareKind, HOUSE_THINGS } from '../dareSchema'
import {
  type MilestoneFacts,
  dareThingPool,
  maybeOpenerOf,
  newMilestonesOf,
  thingsOpenedBy,
} from '../milestones'

// The milestones (src/world/dare/milestones.ts): what each one reads, the
// things four of them open, and the pool the list rolls from. With nothing
// opened the pool is the house's six in their old order, so every seed
// rolls the list it rolled before the journal; with things opened the
// list may ask for them. In co-op the room rolls from its host's things,
// handed in as the room's settings.

const ALL_THING_MILESTONES = [
  'FirstEscape',
  'ThingInEveryRoom',
  'TenThings',
  'ChunkTripleDare',
]

const NEW_THINGS: ReadonlyArray<DareKind> = [
  'NapkinRing',
  'DareNote',
  'FalseTeeth',
  'Invitation',
]

const EVERY_ROOM = [
  KITCHEN_ROOM_ID,
  PARLOUR_ROOM_ID,
  LIBRARY_ROOM_ID,
  CELLAR_ROOM_ID,
]

const factsWith = (
  journal: Partial<SavedJournal>,
  rest: Partial<Omit<MilestoneFacts, 'journal'>> = {},
): MilestoneFacts => ({
  journal: { ...noJournal, ...journal },
  proof: [],
  bonuses: { escapedOn: [] },
  ...rest,
})

const keyFelledOn = (difficulty: string): ProofEntry => ({
  thing: BIG_KEY,
  difficulty,
  stamp: { wave: 10, hero: 'You', crew: [], day: null, ending: 'Escaped' },
})

const listOf = (seed: number, settings: RoomSettings) =>
  startRoomWorld([0], seed, settings).world.dare.list

const SEEDS = Array.range(1, 60)

describe('the milestones', () => {
  test('nothing done reaches nothing', () => {
    expect(newMilestonesOf(factsWith({}))).toEqual([])
  })

  test('each milestone reads what it says, in the table order', () => {
    expect(newMilestonesOf(factsWith({ thingsFound: 1 }))).toEqual([
      'FirstFind',
    ])
    expect(newMilestonesOf(factsWith({ thingsFound: 10 }))).toEqual([
      'FirstFind',
      'TenThings',
    ])
    expect(newMilestonesOf(factsWith({ roomsOpened: EVERY_ROOM }))).toEqual([
      'EveryRoomOpened',
    ])
    expect(
      newMilestonesOf(factsWith({ roomsOpened: EVERY_ROOM.slice(1) })),
    ).toEqual([])
    expect(newMilestonesOf(factsWith({ roomsFoundIn: EVERY_ROOM }))).toEqual([
      'ThingInEveryRoom',
    ])
    expect(
      newMilestonesOf(factsWith({}, { bonuses: { escapedOn: ['Easy'] } })),
    ).toEqual(['FirstEscape'])
    expect(
      newMilestonesOf(factsWith({}, { bonuses: { escapedOn: ['Nightmare'] } })),
    ).toEqual(['FirstEscape', 'EscapeDoubleDare', 'EscapeTripleDogDare'])
    expect(
      newMilestonesOf(factsWith({}, { proof: [keyFelledOn('Normal')] })),
    ).toEqual([])
    expect(
      newMilestonesOf(factsWith({}, { proof: [keyFelledOn('Nightmare')] })),
    ).toEqual(['ChunkTripleDare'])
  })

  test('a milestone already kept is never reached again', () => {
    expect(
      newMilestonesOf(factsWith({ thingsFound: 3, milestones: ['FirstFind'] })),
    ).toEqual([])
  })

  test('four milestones each open one new thing, and the six need none', () => {
    expect(Array.map(NEW_THINGS, kind => maybeOpenerOf(kind))).toEqual([
      Option.some('FirstEscape'),
      Option.some('ThingInEveryRoom'),
      Option.some('ChunkTripleDare'),
      Option.some('TenThings'),
    ])
    Array.forEach(HOUSE_THINGS, kind => {
      expect(maybeOpenerOf(kind)).toEqual(Option.none())
    })
    expect(thingsOpenedBy(['FirstEscape', 'SomeLaterMilestone'])).toEqual([
      'NapkinRing',
    ])
    expect(thingsOpenedBy(ALL_THING_MILESTONES)).toEqual(NEW_THINGS)
  })
})

describe('the pool the list rolls from', () => {
  test('with nothing opened it is the house six, in their order', () => {
    expect(dareThingPool([])).toEqual(HOUSE_THINGS)
    expect(dareThingPool(['Invitation', 'NapkinRing'])).toEqual([
      ...HOUSE_THINGS,
      'NapkinRing',
      'Invitation',
    ])
  })

  // NOTE: pinned from the build before the journal (the same seeds rolled
  // in a checkout of its commit), so a pool that moves fails here.
  test('old seeds roll the lists they always did', () => {
    expect(listOf(1, DEFAULT_ROOM_SETTINGS)).toEqual([
      'GrandmasRecipe',
      'ButlersBell',
      'FamilyPortrait',
    ])
    expect(listOf(3, DEFAULT_ROOM_SETTINGS)).toEqual([
      'ButlersBell',
      'MusicBox',
      'FamilyPortrait',
    ])
    expect(listOf(42, DEFAULT_ROOM_SETTINGS)).toEqual([
      'GrandmasRecipe',
      'MusicBox',
      'FamilyPortrait',
    ])
  })

  test('nothing opened never asks for a new thing', () => {
    Array.forEach(SEEDS, seed => {
      Array.forEach(listOf(seed, DEFAULT_ROOM_SETTINGS), kind => {
        expect(HOUSE_THINGS).toContain(kind)
      })
    })
  })

  test("a co-op room rolls from its host's opened things", () => {
    const hosted: RoomSettings = {
      ...DEFAULT_ROOM_SETTINGS,
      difficulty: 'Nightmare',
      things: NEW_THINGS,
    }
    expect(listOf(1, hosted)).toEqual([
      'NapkinRing',
      'Invitation',
      'GrandmasRecipe',
      'FalseTeeth',
    ])
    const asked = Array.flatMap(SEEDS, seed => listOf(seed, hosted))
    Array.forEach(NEW_THINGS, kind => {
      expect(asked).toContain(kind)
    })
  })

  test('one opened thing joins the roll, the locked ones never do', () => {
    const napkinOnly: RoomSettings = {
      ...DEFAULT_ROOM_SETTINGS,
      things: ['NapkinRing'],
    }
    const asked = Array.flatMap(SEEDS, seed => listOf(seed, napkinOnly))
    expect(asked).toContain('NapkinRing')
    Array.forEach(['DareNote', 'FalseTeeth', 'Invitation'], kind => {
      expect(asked).not.toContain(kind)
    })
  })
})
