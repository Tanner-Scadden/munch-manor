// The frame's costly passes held to a budget by count, not by time: a flow
// field search, a scan of the whole map. A cache that stops hitting, or a
// pass moved into a loop, fails here at once, long before the frame time
// moves by a percent (src/shared/workCount.ts).
import { Effect } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import { TILE_SIZE } from '../../shared/constants'
import { resetWorkCounts, workCounts } from '../../shared/workCount'
import { quietWave } from '../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  press,
  release,
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
      // NOTE: the first frame builds what a level keeps (its maps, its
      // graphs), so the count starts after it.
      const warm = yield* Story.story(
        APPLICATION,
        Story.given(start),
        ...ticks(1, FRAME_MS),
      )
      resetWorkCounts()
      yield* Story.story(
        APPLICATION,
        Story.given(warm),
        ...ticks(FRAMES, FRAME_MS),
      )
      const counts = workCounts()
      expect(counts.MapScan).toBe(0)
      expect(counts.FlowField).toBeLessThanOrEqual(1)
    }),
  )

  it.effect('a walking player costs a field for each tile crossed', () =>
    Effect.gen(function* () {
      const start = crowdOf(quietWave(3), CROWD)
      const warm = yield* Story.story(
        APPLICATION,
        Story.given(start),
        ...ticks(1, FRAME_MS),
      )
      resetWorkCounts()
      const walked = yield* Story.story(
        APPLICATION,
        Story.given(warm),
        press('KeyD'),
        ...ticks(FRAMES, FRAME_MS),
        release('KeyD'),
      )
      const counts = workCounts()
      const tilesCrossed =
        Math.abs(focusOf(walked).player.x - focusOf(warm).player.x) / TILE_SIZE
      expect(tilesCrossed).toBeGreaterThan(3)
      expect(counts.MapScan).toBe(0)
      expect(counts.FlowField).toBeLessThanOrEqual(Math.ceil(tilesCrossed) + 2)
      expect(counts.FlowField).toBeLessThan(FRAMES / 4)
    }),
  )
})
