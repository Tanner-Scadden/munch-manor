// @vitest-environment happy-dom
import { Effect, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { initialModel } from '../../app/pureApp'
import {
  type SavedJournal,
  addToJournal,
  journalAdded,
  mergeJournal,
  noJournal,
} from '../../shared/journalData'
import { readyAfterRead } from '../../test/model.fixture'
import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { jsonOf } from '../../test/testing'
import { changesBetween } from '../playerSync'
import {
  type PlayerSave,
  decodeSave,
  encodeSave,
  restoreSave,
  saveOf,
} from '../save'

// The Dare Journal in the save and through sync (src/shared/journalData.ts,
// src/platform/playerScope.ts): sets that only grow and a count that only
// adds, so two devices that each played a run both keep theirs; a save
// from before the journal loads with it empty.

const journalWith = (journal: Partial<SavedJournal>): SavedJournal => ({
  ...noJournal,
  ...journal,
})

const withJournal = (journal: SavedJournal): PlayerSave => ({
  ...legacySave,
  journal,
})

const PHONE_RUN = journalWith({
  milestones: ['FirstFind'],
  roomsOpened: ['Kitchen'],
  heroesPlayed: ['You'],
  thingsFound: 2,
})

const LAPTOP_RUN = journalWith({
  roomsOpened: ['Cellar'],
  heroesPlayed: ['LineCook'],
  thingsFound: 1,
})

describe('the journal data', () => {
  it('a run adds what is new as one increment, and nothing when nothing is', () => {
    expect(journalAdded(noJournal, PHONE_RUN)).toEqual([PHONE_RUN])
    expect(journalAdded(PHONE_RUN, PHONE_RUN)).toEqual([])
    expect(
      journalAdded(PHONE_RUN, addToJournal(PHONE_RUN, LAPTOP_RUN)),
    ).toEqual([LAPTOP_RUN])
  })

  it('merging keeps every id and the larger count', () => {
    expect(mergeJournal(PHONE_RUN, LAPTOP_RUN)).toEqual({
      milestones: ['FirstFind'],
      roomsOpened: ['Cellar', 'Kitchen'],
      roomsFoundIn: [],
      heroesPlayed: ['LineCook', 'You'],
      thingsFound: 2,
    })
  })

  it('a change to the journal goes up as KeptJournal', () => {
    expect(
      changesBetween(withJournal(noJournal), withJournal(PHONE_RUN)),
    ).toEqual([{ _tag: 'KeptJournal', added: PHONE_RUN }])
  })
})

describe('the journal in the save', () => {
  it('round-trips', () => {
    const played = modifyFields(readyAfterRead, { journal: () => PHONE_RUN })
    const raw = Option.getOrThrow(encodeSave(saveOf(played)))
    const decoded = Option.getOrThrow(decodeSave(raw))
    expect(restoreSave(initialModel, decoded).journal).toEqual(PHONE_RUN)
  })

  it('a save from before the journal loads with it empty', () => {
    const { journal: _journal, ...withoutJournal } = saveOf(
      modifyFields(readyAfterRead, { journal: () => PHONE_RUN }),
    )
    const versionTwentyFour = jsonOf({ ...withoutJournal, version: 24 })
    const migrated = Option.getOrThrow(decodeSave(versionTwentyFour))
    expect(migrated.journal).toEqual(noJournal)
  })
})

describe('the journal in sync', () => {
  it.effect('two devices that each played a run both keep both', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(phone, legacySave, withJournal(PHONE_RUN))
        yield* write(laptop, legacySave, withJournal(LAPTOP_RUN))
        const isSettled = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(
            maybeSave,
            save =>
              save.journal.thingsFound === 3 &&
              save.journal.roomsOpened.length === 2 &&
              save.journal.milestones.length === 1,
          )
        const onPhone = yield* until(phone.load, isSettled)
        const onLaptop = yield* until(laptop.load, isSettled)
        expect(isSettled(onPhone)).toBe(true)
        expect(isSettled(onLaptop)).toBe(true)
      }),
    ),
  )
})
