import { Array } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { START_LEVEL } from '#world/level/arena.ts'
import { rollWave } from '#world/waves/endlessWaves.ts'

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
