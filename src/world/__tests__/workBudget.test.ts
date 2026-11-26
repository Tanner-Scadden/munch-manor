import { Effect } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { TILE_SIZE } from '../../shared/constants'
import { resetWorkCounts, workCounts } from '../../shared/workCount'
import { quietWave } from '../../test/model.fixture'
import {
  FRAME_MS,
  modelAfter,
  press,
  release,
  steps,
  ticks,
} from '../../test/testing'
import { focusOf } from '../party/party'
import { crowdOf } from './workBudget.fixture'

const CROWD = 15
const FRAMES = 240

describe('the work budget', () => {
  it.effect('a crowd chasing a player who keeps still lays out one field', () =>
    Effect.gen(function* () {
      const start = crowdOf(quietWave(3), CROWD)
      const warm = yield* modelAfter(start, ticks(1, FRAME_MS))
      resetWorkCounts()
      yield* modelAfter(warm, ticks(FRAMES, FRAME_MS))
      const counts = workCounts()
      expect(counts.MapScan).toBe(0)
      expect(counts.FlowField).toBeLessThanOrEqual(1)
      expect(counts.LevelTable).toBe(0)
    }),
  )

  it.effect('a walking player costs a field for each tile crossed', () =>
    Effect.gen(function* () {
      const start = crowdOf(quietWave(3), CROWD)
      const warm = yield* modelAfter(start, ticks(1, FRAME_MS))
      resetWorkCounts()
      const walked = yield* modelAfter(
        warm,
        steps(press('KeyD'), ticks(FRAMES, FRAME_MS), release('KeyD')),
      )
      const counts = workCounts()
      const tilesCrossed =
        Math.abs(focusOf(walked).player.x - focusOf(warm).player.x) / TILE_SIZE
      expect(tilesCrossed).toBeGreaterThan(3)
      expect(counts.MapScan).toBe(0)
      expect(counts.FlowField).toBeLessThanOrEqual(Math.ceil(tilesCrossed) + 2)
      expect(counts.FlowField).toBeLessThan(FRAMES / 4)
      expect(counts.LevelTable).toBe(0)
    }),
  )
})
