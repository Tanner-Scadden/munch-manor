// The full wave sim test: wave 1 played to its end three times. It takes
// about a second, so it runs in `bun run test:full` and CI, not in
// `bun run test`. The wave rules are in waves.story.test.ts.
import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import { releaseWalk, walkToward } from '../../../test/lensTesting'
import { readyModel } from '../../../test/model.fixture'
import {
  checkModel,
  holdFireToward,
  modelAfter,
  press,
  release,
  startRunFromHome,
  steps,
  tick,
  ticks,
} from '../../../test/testing'
import { focusOf } from '../../party/party'
import { scoreOf } from '../../run/stats'

const FRAME_MS = 50

describe('a full wave', () => {
  const SECONDS_PER_RUN = 40
  // NOTE: from the start spot, up the map into the aisle below the party
  // table, then east past the table's end (the stick walks the map's ways,
  // which the turned lens shows a hair off the screen's), under the North door's lane, where the
  // shots fly up it clear of the table and the chandelier.
  const STEP_UP_TICKS = 4
  const STEP_RIGHT_TICKS = 28
  // NOTE: wave 1 draws its doors from the run's seed (2026-11-14); these two
  // seeds roll both its squads through the North door, the lane the player
  // stands under.
  const NORTH_SEED = 15
  const OTHER_NORTH_SEED = 45

  // NOTE: every frame's Model of the wave, gathered in an array the Story
  // alone fills, as `recordTicks` gathers them.
  const playFirstWave = (seed: number) =>
    Effect.suspend(() => {
      const frames: Array<Model> = []
      const record = checkModel((frame: Model) => {
        frames.push(frame)
      })
      return modelAfter(
        UiStruct.evolve(readyModel, { rngState: () => seed }),
        steps(
          startRunFromHome,
          release('Enter'),
          walkToward({ x: 0, y: -1 }),
          ticks(STEP_UP_TICKS, FRAME_MS),
          releaseWalk,
          walkToward({ x: 1, y: 0 }),
          ticks(STEP_RIGHT_TICKS, FRAME_MS),
          releaseWalk,
          walkToward({ x: 0, y: -1 }),
          tick(FRAME_MS),
          releaseWalk,
          press('Enter'),
          holdFireToward({ x: 0, y: -1 }),
          ...Array.makeBy((SECONDS_PER_RUN * 1000) / FRAME_MS, () =>
            steps(tick(FRAME_MS), record),
          ),
        ),
      ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
    })

  it.effect(
    'wave 1 can be cleared, leads to wave 2 preparation, and replays identically',
    () =>
      Effect.gen(function* () {
        const first = yield* playFirstWave(NORTH_SEED)
        const second = yield* playFirstWave(NORTH_SEED)

        const maybeCleared = Array.findFirst(
          first,
          ({ phase }) => Phase.guards.Preparation(phase) && phase.wave === 2,
        )
        const cleared = Option.getOrThrow(maybeCleared)
        expect(scoreOf(cleared.stats)).toBeGreaterThan(0)
        expect(focusOf(cleared).player.hp).toBeGreaterThan(0)
        expect(focusOf(cleared).player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP)
        expect(second).toEqual(first)
        const other = yield* playFirstWave(OTHER_NORTH_SEED)
        expect(other).not.toEqual(first)
      }),
  )
})
