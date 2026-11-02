// The full wave sim test: wave 1 played to its end three times. It takes
// about a second, so it runs in `bun run test:full` and CI, not in
// `bun run test`. The wave rules are in waves.story.test.ts.
import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PLAYER_MAX_HP } from './constants'
import { update } from './main'
import { type Model, Phase } from './model'
import { readyModel } from './model.fixture'
import { scoreOf } from './stats'
import {
  holdFireToward,
  press,
  release,
  startRunFromHome,
  tick,
  ticks,
} from './testing'

const FRAME_MS = 50

describe('a full wave', () => {
  const SECONDS_PER_RUN = 40
  const STEP_RIGHT_TICKS = 17

  const playFirstWave = (seed: number): ReadonlyArray<Model> => {
    const frames: Array<Model> = []
    const record = model((frame: Model) => {
      frames.push(frame)
    })
    story(
      update,
      given(modifyFields(readyModel, { rngState: () => seed })),
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
    )
    return frames
  }

  test('wave 1 can be cleared, leads to wave 2 preparation, and replays identically', () => {
    const first = playFirstWave(1234)
    const second = playFirstWave(1234)

    const maybeCleared = Array.findFirst(
      first,
      ({ phase }) => Phase.guards.Preparation(phase) && phase.wave === 2,
    )
    const cleared = Option.getOrThrow(maybeCleared)
    expect(scoreOf(cleared.stats)).toBeGreaterThan(0)
    expect(cleared.player.hp).toBeGreaterThan(0)
    expect(cleared.player.hp).toBeLessThanOrEqual(PLAYER_MAX_HP)
    expect(second).toEqual(first)
    expect(playFirstWave(98765)).not.toEqual(first)
  })
})
