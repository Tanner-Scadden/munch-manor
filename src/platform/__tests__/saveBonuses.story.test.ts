import { Option, Record } from 'effect'

import { describe, expect, test } from '@effect/vitest'

import { initialModel } from '../../app/pureApp'
import { jsonOf } from '../../test/testing'
import { type PlayerSave, decodeSave, restoreSave, saveOf } from '../save'
import { learnedSave } from './save.fixture'

// The Bones bonuses and the best runs in the save (version 21): a version
// 20 save loads with no bonus claimed and no best run, both round trip, and
// a synced save keeps the bonuses this device already claimed.

const claimed: PlayerSave = {
  ...learnedSave,
  bonuses: { doubledDay: '2026-11-11', escapedOn: ['Normal', 'Hard'] },
  records: {
    ...learnedSave.records,
    Normal: {
      ...learnedSave.records.Normal,
      bestRun: { wave: 8, things: ['MusicBox', 'SilverSpoon'] },
    },
  },
}

describe('the save of the Bones bonuses and the best runs', () => {
  test('a version 20 save keeps everything, with no bonus claimed and no best run', () => {
    const { bonuses: _bonuses, ...versionTwentySave } = claimed
    const json = jsonOf({
      ...versionTwentySave,
      version: 20,
      records: Record.map(
        learnedSave.records,
        ({ furthestWave, mostKills }) => ({
          furthestWave,
          mostKills,
        }),
      ),
    })
    expect(decodeSave(json)).toEqual(Option.some(learnedSave))
  })

  test('the bonuses and a best run round trip through the Model', () => {
    const restored = restoreSave(initialModel, claimed)
    expect(restored.bonuses).toEqual(claimed.bonuses)
    expect(restored.bests.byDifficulty.Normal.maybeBestRun).toEqual(
      Option.some({ wave: 8, things: ['MusicBox', 'SilverSpoon'] }),
    )
    expect(saveOf(restored).bonuses).toEqual(claimed.bonuses)
    expect(saveOf(restored).records.Normal.bestRun).toEqual(
      claimed.records.Normal.bestRun,
    )
  })

  test('a thing no longer in the game drops out of the best run', () => {
    const restored = restoreSave(initialModel, {
      ...claimed,
      records: {
        ...claimed.records,
        Normal: {
          ...claimed.records.Normal,
          bestRun: { wave: 8, things: ['MusicBox', 'RubberChicken'] },
        },
      },
    })
    expect(restored.bests.byDifficulty.Normal.maybeBestRun).toEqual(
      Option.some({ wave: 8, things: ['MusicBox'] }),
    )
  })

  test('a synced save keeps the later doubled day and every escape', () => {
    const here = restoreSave(initialModel, {
      ...learnedSave,
      bonuses: { doubledDay: '2026-11-12', escapedOn: ['Easy'] },
    })
    const synced = restoreSave(here, claimed)
    expect(synced.bonuses).toEqual({
      doubledDay: '2026-11-12',
      escapedOn: ['Easy', 'Normal', 'Hard'],
    })
  })
})
