// @vitest-environment happy-dom
import { Effect, Option } from 'effect'

import { describe, expect, it, test } from '@effect/vitest'

import { initialModel } from '../../app/pureApp'
import {
  legacySave,
  linkedPair,
  synced,
  until,
  write,
} from '../../test/store.fixture'
import { jsonOf } from '../../test/testing'
import { changesBetween } from '../playerSync'
import { type PlayerSave, decodeSave, restoreSave, saveOf } from '../save'
import { learnedSave } from './save.fixture'

// How the last run ended in the save (version 22), for the friends in the
// car: a version 21 save loads as no run yet, it round trips through the
// Model, and a run's end goes to linked devices as its own change.

const escaped: PlayerSave = { ...legacySave, lastRun: 'Escaped' }

describe('the last run in the save', () => {
  test('a version 21 save keeps everything, with no run yet', () => {
    const { lastRun: _lastRun, ...versionTwentyOne } = learnedSave
    expect(decodeSave(jsonOf({ ...versionTwentyOne, version: 21 }))).toEqual(
      Option.some(learnedSave),
    )
  })

  test('round trips through the Model', () => {
    const restored = restoreSave(initialModel, escaped)
    expect(restored.lastRunEnding).toBe('Escaped')
    expect(saveOf(restored).lastRun).toBe('Escaped')
  })

  test('a run that ends another way goes up as EndedRun', () => {
    expect(changesBetween(legacySave, escaped)).toEqual([
      { _tag: 'EndedRun', lastRun: 'Escaped' },
    ])
    expect(changesBetween(escaped, escaped)).toEqual([])
  })

  it.effect('reaches the linked device', () =>
    synced(
      Effect.gen(function* () {
        const { phone, laptop } = yield* linkedPair
        yield* write(phone, legacySave, escaped)
        const hasEscaped = (maybeSave: Option.Option<PlayerSave>) =>
          Option.exists(maybeSave, save => save.lastRun === 'Escaped')
        const onLaptop = yield* until(laptop.load, hasEscaped)
        expect(hasEscaped(onLaptop)).toBe(true)
      }),
    ),
  )
})
