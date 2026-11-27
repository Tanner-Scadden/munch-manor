import { Array, Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase } from '#app/model.ts'
import { WriteSave } from '#app/update/save.ts'
import {
  hasNewJournalPage,
  markJournalSeen,
  milestoneUnlockId,
  openedThingsOf,
} from '#domain/journal.ts'
import {
  diesOnWave7,
  frame,
  lastWave,
} from '#features/end/__tests__/rank.fixture.ts'
import { EndUnlock, unlocksOf } from '#features/end/endBeat.ts'
import { noJournal } from '#shared/records/journalData.ts'
import { knowingDay, readyModel, withDareThings } from '#test/model.fixture.ts'
import {
  checkModel,
  checkPendingArgs,
  press,
  storyOf,
  writeSave,
} from '#test/testing.ts'
import { type DareThing, DareThingState } from '#world/dare/dareSchema.ts'
import { focusOf } from '#world/party/party.ts'

const TODAY = '2026-11-13'

const PAGE: DareThing = {
  id: 0,
  kind: 'GuestBookPage',
  state: DareThingState.Found({ slot: 0 }),
}

const munchedWithPage = knowingDay(withDareThings(diesOnWave7, [PAGE]), TODAY)

const escapingToday = knowingDay(lastWave, TODAY)

describe('a run that ends', () => {
  it.effect(
    'adds its finds and hero to the journal, reaches the first find, and saves it once',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(munchedWithPage)
        s.pipe(
          frame,
          checkModel(model => {
            expect(Phase.guards.GameOver(model.phase)).toBe(true)
            expect(model.journal.thingsFound).toBe(1)
            expect(model.journal.heroesPlayed).toEqual([
              focusOf(munchedWithPage).player.calling,
            ])
            expect(model.journal.milestones).toEqual(['FirstFind'])
            expect(model.runGains.journalRun.reached).toEqual(['FirstFind'])
            expect(hasNewJournalPage(model)).toBe(true)
            expect(openedThingsOf(model)).toEqual([])
          }),
          checkPendingArgs(WriteSave)(writes => {
            const saved = Array.flatMap(writes, write => write.changes)
            expect(
              Array.filter(saved, change => change._tag === 'KeptJournal'),
            ).toHaveLength(1)
          }),
          writeSave,
          frame,
          checkModel(model => {
            expect(model.journal.thingsFound).toBe(1)
            expect(model.journal.milestones).toEqual(['FirstFind'])
          }),
        )
      }),
  )

  it.effect(
    'an escape reaches the first escape, which opens the napkin ring, with a card for each',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(escapingToday)
        s.pipe(
          frame,
          checkModel(model => {
            expect(Phase.guards.Escaped(model.phase)).toBe(true)
            expect(model.journal.milestones).toContain('FirstEscape')
            expect(model.runGains.journalRun.reached).toContain('FirstEscape')
            expect(openedThingsOf(model)).toEqual(['NapkinRing'])
            expect(unlocksOf(model)).toEqual(
              expect.arrayContaining([
                EndUnlock.Milestone({ milestone: 'FirstFind' }),
                EndUnlock.Milestone({ milestone: 'FirstEscape' }),
              ]),
            )
          }),
          writeSave,
        )
      }),
  )

  it.effect('a milestone already in the journal raises no second card', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(munchedWithPage, {
          journal: () => ({
            ...noJournal,
            milestones: ['FirstFind'],
            thingsFound: 4,
          }),
        }),
      )
      s.pipe(
        frame,
        checkModel(model => {
          expect(model.journal.thingsFound).toBe(5)
          expect(model.runGains.journalRun.reached).toEqual([])
          expect(
            Array.filter(
              unlocksOf(model),
              unlock => unlock._tag === 'Milestone',
            ),
          ).toEqual([])
        }),
        writeSave,
      )
    }),
  )
})

describe('the journal pip', () => {
  const withPage: Model = UiStruct.evolve(readyModel, {
    journal: () => ({ ...noJournal, milestones: ['FirstFind'] }),
  })

  it.effect('shows until the journal opens, which marks the page NEW', () =>
    Effect.gen(function* () {
      expect(hasNewJournalPage(withPage)).toBe(true)
      const s = yield* storyOf(withPage)
      s.pipe(
        press('KeyZ'),
        checkModel(model => {
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
        UiStruct.evolve(seen, { freshUnlocks: () => [] }),
      )
      expect(again.freshUnlocks).toEqual([])
    }),
  )
})
