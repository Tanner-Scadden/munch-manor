import { Array } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { START_LEVEL } from '../../level/arena'
import { rollWave } from '../endlessWaves'

// Wave 1's two squads each come through a door drawn from the run's seed,
// so the opening is not the same room every run (owner, 2026-11-14).

const doorsOfWave1 = (seed: number): ReadonlyArray<string> =>
  Array.dedupe(
    Array.map(
      rollWave(seed, 1, START_LEVEL.doorIds)[1].spawns,
      ({ door }) => door,
    ),
  )

describe('wave 1’s doors', () => {
  it('change from run to run, and each squad keeps to one door', () => {
    const seeds = Array.makeBy(40, seed => seed + 1)
    const doors = Array.dedupe(Array.flatMap(seeds, doorsOfWave1))
    expect(doors.length).toBeGreaterThan(2)
    Array.forEach(seeds, seed => {
      expect(doorsOfWave1(seed).length).toBeLessThanOrEqual(2)
    })
  })
})
