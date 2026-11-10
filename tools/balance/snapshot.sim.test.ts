import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'

import { focusOf } from '../../src/world/party/party'
import { encodeJson } from '../json'
import { waveSeedAt } from './bot'
import { DEFAULT_OPTIONS } from './bot/basics'
import {
  playSnapshot,
  playWavePass,
  rerolled,
  snapshotFor,
  waveStarts,
} from './bot/snapshots'
import { summarizeWave } from './summary'

// NOTE: the smoke pass plays wave 2 from two snapshot slots, three runs, so
// it stays a few seconds, in the sim tier (`bun run test:full` and CI). It
// catches gross regressions only: a wave 2 the bot can no longer clear, a
// snapshot that is not deterministic, or a wave that never ends. The real pass is `bun run balance -- --wave 2 --runs 100`.
const SMOKE_WAVE = 2

const toJson = encodeJson(Schema.Unknown)

describe('wave snapshots', () => {
  test('the same seed gives the same snapshot', () => {
    const first = snapshotFor(SMOKE_WAVE, 0, 2, DEFAULT_OPTIONS, 1, SMOKE_WAVE)
    const again = waveStarts(1, { ...DEFAULT_OPTIONS }, SMOKE_WAVE).get(
      SMOKE_WAVE,
    )
    expect(first).toBeDefined()
    expect(first?.model.phase._tag).toBe('Preparation')
    expect(first?.model.stats.wavesCleared).toBe(SMOKE_WAVE - 1)
    expect(toJson(again)).toBe(toJson(first?.model))
  })

  test('a snapshot derived twice from scratch is the same', () => {
    const fromSeed = (seed: number) =>
      toJson(
        waveStarts(seed, { ...DEFAULT_OPTIONS, noUpgrades: false }, 1).get(1),
      )
    expect(fromSeed(5)).toBe(fromSeed(5))
    expect(fromSeed(5)).not.toBe(fromSeed(6))
  })

  test('a reroll keeps the gear and rolls a new wave', () => {
    const snapshot = snapshotFor(
      SMOKE_WAVE,
      0,
      2,
      DEFAULT_OPTIONS,
      1,
      SMOKE_WAVE,
    )
    expect(snapshot).toBeDefined()
    if (snapshot === undefined) {
      return
    }
    const rolled = rerolled(snapshot.model, waveSeedAt(1, 0))
    const phaseOf = (seed: number) =>
      toJson(rerolled(snapshot.model, seed).phase)
    expect(rolled.keys).toEqual(snapshot.model.keys)
    expect(focusOf(rolled).player.arsenal).toEqual(
      focusOf(snapshot.model).player.arsenal,
    )
    expect(rolled.phase._tag).toBe('Preparation')
    expect(phaseOf(waveSeedAt(1, 0))).toBe(phaseOf(waveSeedAt(1, 0)))
    expect(phaseOf(waveSeedAt(1, 0))).not.toBe(phaseOf(waveSeedAt(1, 1)))
    expect(toJson(rolled.phase)).not.toBe(toJson(snapshot.model.phase))
  })

  test('the smoke pass clears wave 2 the same way every time', () => {
    const pass = {
      waves: [SMOKE_WAVE],
      runs: 3,
      slots: 2,
      firstSeed: 1,
      seedOffset: 0,
    }
    const runs = playWavePass(pass, DEFAULT_OPTIONS, () => true)
    const summary = summarizeWave(SMOKE_WAVE, runs)
    expect(summary.runs).toBe(3)
    expect(summary.snapshots).toBe(2)
    expect(summary.clearedShare).toBe(1)
    expect(summary.meanLengthSeconds).toBeGreaterThan(15)
    expect(summary.meanLengthSeconds).toBeLessThan(120)
    const snapshot = snapshotFor(
      SMOKE_WAVE,
      0,
      2,
      DEFAULT_OPTIONS,
      1,
      SMOKE_WAVE,
    )
    if (snapshot === undefined) {
      return
    }
    expect(playSnapshot(snapshot, waveSeedAt(1, 0), DEFAULT_OPTIONS)).toEqual(
      runs[0],
    )
  })
})
