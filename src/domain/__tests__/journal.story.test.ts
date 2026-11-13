import { Array, Effect } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase } from '../../app/model'
import {
  checkSavedChanges,
  diesOnWave7,
  frame,
  lastWave,
} from '../../features/end/__tests__/rank.fixture'
import { EndUnlock, unlocksOf } from '../../features/end/endBeat'
import { noJournal } from '../../shared/journalData'
import {
  knowingDay,
  readyModel,
  withDareThings,
} from '../../test/model.fixture'
import { APPLICATION, press, showDialog, writeSave } from '../../test/testing'
import { type DareThing, DareThingState } from '../../world/dare/dareSchema'
import { focusOf } from '../../world/party/party'
import {
  hasNewJournalPage,
  markJournalSeen,
  milestoneUnlockId,
  openedThingsOf,
} from '../journal'

// The Dare Journal's root side (src/domain/journal.ts): what a run adds to
// the journal as it reaches its end screen, the milestones that reaches,
// their unlock cards on the end card, the things they open for the next
// run, and the journal's NEW pip.

const TODAY = '2026-11-13'

const PAGE: DareThing = {
  id: 0,
  kind: 'GuestBookPage',
  state: DareThingState.Found({ slot: 0 }),
}

// NOTE: a Normal run about to die on wave 7 with one thing found.
const munchedWithPage = knowingDay(withDareThings(diesOnWave7, [PAGE]), TODAY)

const escapingToday = knowingDay(lastWave, TODAY)

describe('a run that ends', () => {
  it.effect(
    'adds its finds and hero to the journal, reaches the first find, and saves it once',
    () =>
      Story.story(
        APPLICATION,
        Story.given(munchedWithPage),
        frame,
        Story.model(model => {
          expect(Phase.guards.GameOver(model.phase)).toBe(true)
          expect(model.journal.thingsFound).toBe(1)
          expect(model.journal.heroesPlayed).toEqual([
            focusOf(munchedWithPage).player.calling,
          ])
          expect(model.journal.milestones).toEqual(['FirstFind'])
          expect(model.journalRun.reached).toEqual(['FirstFind'])
          expect(hasNewJournalPage(model)).toBe(true)
          expect(openedThingsOf(model)).toEqual([])
        }),
        checkSavedChanges(changes => {
          expect(
            Array.filter(changes, change => change._tag === 'KeptJournal'),
          ).toHaveLength(1)
        }),
        writeSave(),
        frame,
        Story.model(model => {
          expect(model.journal.thingsFound).toBe(1)
          expect(model.journal.milestones).toEqual(['FirstFind'])
        }),
      ),
  )

  it.effect(
    'an escape reaches the first escape, which opens the napkin ring, with a card for each',
    () =>
      Story.story(
        APPLICATION,
        Story.given(escapingToday),
        frame,
        Story.model(model => {
          expect(Phase.guards.Escaped(model.phase)).toBe(true)
          expect(model.journal.milestones).toContain('FirstEscape')
          expect(model.journalRun.reached).toContain('FirstEscape')
          expect(openedThingsOf(model)).toEqual(['NapkinRing'])
          expect(unlocksOf(model)).toEqual(
            expect.arrayContaining([
              EndUnlock.Milestone({ milestone: 'FirstFind' }),
              EndUnlock.Milestone({ milestone: 'FirstEscape' }),
            ]),
          )
        }),
        writeSave(),
      ),
  )

  it.effect('a milestone already in the journal raises no second card', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(munchedWithPage, {
          journal: () => ({
            ...noJournal,
            milestones: ['FirstFind'],
            thingsFound: 4,
          }),
        }),
      ),
      frame,
      Story.model(model => {
        expect(model.journal.thingsFound).toBe(5)
        expect(model.journalRun.reached).toEqual([])
        expect(
          Array.filter(unlocksOf(model), unlock => unlock._tag === 'Milestone'),
        ).toEqual([])
      }),
      writeSave(),
    ),
  )
})

describe('the journal pip', () => {
  const withPage: Model = modifyFields(readyModel, {
    journal: () => ({ ...noJournal, milestones: ['FirstFind'] }),
  })

  it.effect('shows until the journal opens, which marks the page NEW', () =>
    Effect.gen(function* () {
      expect(hasNewJournalPage(withPage)).toBe(true)
      yield* Story.story(
        APPLICATION,
        Story.given(withPage),
        press('KeyZ'),
        showDialog(),
        Story.model(model => {
          expect(hasNewJournalPage(model)).toBe(false)
          expect(model.seenUnlocks).toContain(milestoneUnlockId('FirstFind'))
          expect(model.freshUnlocks).toContain(milestoneUnlockId('FirstFind'))
        }),
      )
    }),
  )

  it.effect('a page seen once wears no NEW the next time', () =>
    Effect.sync(() => {
      const seen = markJournalSeen(withPage)
      const again = markJournalSeen(
        modifyFields(seen, { freshUnlocks: () => [] }),
      )
      expect(again.freshUnlocks).toEqual([])
    }),
  )
})
