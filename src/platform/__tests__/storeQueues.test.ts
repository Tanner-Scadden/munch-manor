// @vitest-environment happy-dom
import { Effect, Array as EffectArray, Option } from 'effect'

import { describe, expect, it } from '@effect/vitest'
import { makeHub } from '@munch/sqlite-wasm-effect/in-process'

import {
  legacySave,
  makeLegacy,
  openOn,
  sqlOn,
  write,
} from '../../test/store.fixture'
import { type PlayerDatabase } from '../storeSqlite'

// What the store keeps on this device alone, apart from the synced save:
// run summaries queued with no network, and RECORD MY RUNS' unlock and its
// queued recordings. Split from store.test.ts.

describe('run summaries queued with no network', () => {
  const takeAll = (database: PlayerDatabase) =>
    Effect.gen(function* () {
      const taken: Array<string> = []
      for (;;) {
        const maybeBody = yield* database.takeQueuedSummary
        if (Option.isNone(maybeBody)) {
          return taken
        }
        taken.push(maybeBody.value)
      }
    })

  it.effect('come out oldest first, and each only once', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const value_19 = yield* makeHub()
      const local = yield* openOn(value_19, legacy.legacy)
      yield* local.queueSummary('first')
      yield* local.queueSummary('second')
      const takeQueuedSummary_1 = yield* local.takeQueuedSummary
      expect(takeQueuedSummary_1).toEqual(Option.some('first'))
      const value_20 = yield* takeAll(local)
      expect(value_20).toEqual(['second'])
      const takeQueuedSummary_2 = yield* local.takeQueuedSummary
      expect(takeQueuedSummary_2).toEqual(Option.none())
    }),
  )

  it.effect('wait through a reload, on the same device', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const hub = yield* makeHub()
      const before = yield* openOn(hub, legacy.legacy)
      yield* before.queueSummary('flight home')
      const after = yield* openOn(hub, legacy.legacy)
      const value_21 = yield* takeAll(after)
      expect(value_21).toEqual(['flight home'])
    }),
  )

  it.effect('keep only the newest few when a trip is long', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const value_22 = yield* makeHub()
      const local = yield* openOn(value_22, legacy.legacy)
      yield* Effect.forEach(EffectArray.range(1, 25), run =>
        local.queueSummary(`run ${run}`),
      )
      const taken = yield* takeAll(local)
      expect(taken).toHaveLength(20)
      expect(taken[0]).toBe('run 6')
      expect(taken[19]).toBe('run 25')
    }),
  )

  it.effect('can all be cleared', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const value_23 = yield* makeHub()
      const local = yield* openOn(value_23, legacy.legacy)
      yield* local.queueSummary('one')
      yield* local.queueSummary('two')
      yield* local.clearQueuedSummaries
      const value_24 = yield* takeAll(local)
      expect(value_24).toEqual([])
    }),
  )
})

describe('RECORD MY RUNS on this device', () => {
  const takeAllRecordings = (database: PlayerDatabase) =>
    Effect.gen(function* () {
      const taken: Array<string> = []
      for (;;) {
        const maybeBody = yield* database.takeQueuedRecording
        if (Option.isNone(maybeBody)) {
          return taken
        }
        taken.push(maybeBody.value)
      }
    })

  it.effect('a mark from before the unlock synced is still read', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const hub = yield* makeHub()
      const before = yield* openOn(hub, legacy.legacy)
      const wasUnlocked = yield* before.isRecordUnlocked
      expect(wasUnlocked).toBe(false)
      const sql = yield* sqlOn(hub)
      yield* sql`INSERT INTO store_meta (key, value)
        VALUES ('record-unlock', 'Unlocked')`
      const after = yield* openOn(hub, legacy.legacy)
      const isUnlocked = yield* after.isRecordUnlocked
      expect(isUnlocked).toBe(true)
    }),
  )

  it.effect('the unlock lasts through a reload, in the save', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.some(legacySave))
      const hub = yield* makeHub()
      const before = yield* openOn(hub, legacy.legacy)
      yield* write(before, legacySave, {
        ...legacySave,
        recordUnlock: 'Unlocked',
      })
      const after = yield* openOn(hub, legacy.legacy)
      const maybeSave = yield* after.load
      expect(Option.map(maybeSave, save => save.recordUnlock)).toEqual(
        Option.some('Unlocked'),
      )
    }),
  )

  it.effect('queued recordings keep only the newest few, oldest first', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const hub = yield* makeHub()
      const local = yield* openOn(hub, legacy.legacy)
      yield* Effect.forEach(EffectArray.range(1, 6), run =>
        local.queueRecording(`run ${run}`),
      )
      const taken = yield* takeAllRecordings(local)
      expect(taken).toEqual(['run 3', 'run 4', 'run 5', 'run 6'])
    }),
  )

  it.effect('queued recordings can all be cleared', () =>
    Effect.gen(function* () {
      const legacy = yield* makeLegacy(Option.none())
      const hub = yield* makeHub()
      const local = yield* openOn(hub, legacy.legacy)
      yield* local.queueRecording('one')
      yield* local.clearQueuedRecordings
      const taken = yield* takeAllRecordings(local)
      expect(taken).toEqual([])
    }),
  )
})
