// The full wave sim test: wave 1 played to its end three times. It takes
// about a second, so it runs in `bun run test:full` and CI, not in
// `bun run test`. The wave rules are in waves.story.test.ts.
import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase } from '../../../app/model'
import { PLAYER_MAX_HP } from '../../../shared/constants'
import { readyModel } from '../../../test/model.fixture'
import {
  APPLICATION,
  holdFireToward,
  press,
  release,
  startRunFromHome,
  tick,
  ticks,
} from '../../../test/testing'
import { focusOf } from '../../party/party'
import { scoreOf } from '../../run/stats'

const FRAME_MS = 50

describe('a full wave', () => {
  const SECONDS_PER_RUN = 40
  const STEP_RIGHT_TICKS = 17

  // NOTE: every frame's Model of the wave, gathered in an array the Story
  // alone fills, as `recordTicks` gathers them.
  const playFirstWave = (seed: number) =>
    Effect.suspend(() => {
      const frames: Array<Model> = []
      const record = Story.model((frame: Model) => {
        frames.push(frame)
      })
      return Story.story(
        APPLICATION,
        Story.given(modifyFields(readyModel, { rngState: () => seed })),
        startRunFromHome,
        release('Enter'),
        press('KeyD'),
        ...ticks(STEP_RIGHT_TICKS, FRAME_MS),
        release('KeyD'),
        press('KeyW'),
        tick(FRAME_MS),
        release('KeyW'),
        press('Enter'),
        holdFireToward({ x: 0, y: -1 }),
        ...Array.flatMap(
          ticks((SECONDS_PER_RUN * 1000) / FRAME_MS, FRAME_MS),
          frame => [frame, record],
        ),
      ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
    })

  it.effect(
    'wave 1 can be cleared, leads to wave 2 preparation, and replays identically',
    () =>
      Effect.gen(function* () {
        const first = yield* playFirstWave(1234)
        const second = yield* playFirstWave(1234)

        const maybeCleared = Array.findFirst(
          first,
          ({ phase }) => Phase.guards.Preparation(phase) && phase.wave === 2,
        )
        const cleared = Option.getOrThrow(maybeCleared)
        expect(scoreOf(cleared.stats)).toBeGreaterThan(0)
        expect(focusOf(cleared).player.hp).toBeGreaterThan(0)
        expect(focusOf(cleared).player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP)
        expect(second).toEqual(first)
        const other = yield* playFirstWave(98765)
        expect(other).not.toEqual(first)
      }),
  )
})
