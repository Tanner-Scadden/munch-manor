// The fixed step (MULTIPLAYER.md, Phase 0, step 2): the world steps in
// whole 60 Hz ticks whatever the display's rate, so the same held inputs
// over the same time play the same game at 30, 60, and 120 Hz.

import { Array, Effect } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../src/app/message'
import type { Model } from '../../src/app/model'
import { playedThrough } from '../../src/test/testing'
import { firstDifference } from './diff'
import { gameplayOf } from './fields'
import { startedRun } from './script'

// NOTE: the script's run (its start is the determinism tool's own), past
// the break, with D held and the mouse held down on a spot up and right.
const started = playedThrough(startedRun(3, 'Campaign'), [
  Message.PressedKey({ code: 'Enter' }),
  Message.PressedKey({ code: 'KeyD' }),
  Message.MovedMouse({ clientX: 300, clientY: 40 }),
  Message.PressedPointer({
    pointerId: 1,
    device: 'Mouse',
    clientX: 300,
    clientY: 40,
  }),
])

// NOTE: a frame's events are all its ticks' events, so a 30 Hz frame holds
// two ticks' worth, and the run stats count frames and their real time.
// Everything else must match.
const worldOf = (model: Model): Readonly<Record<string, unknown>> => {
  const { frameEvents: _events, stats: _stats, ...rest } = gameplayOf(model)
  const {
    activeFrames: _frames,
    activeFrameMs: _frameMs,
    runMs: _runMs,
    ...counts
  } = model.stats
  return { ...rest, stats: counts }
}

const playFor = (seconds: number, hz: number) =>
  Effect.flatMap(started, model =>
    playedThrough(
      model,
      Array.makeBy(seconds * hz, () =>
        Message.TickedFrame({ deltaTime: 1000 / hz }),
      ),
    ),
  )

describe('the fixed step', () => {
  it.effect('120 Hz frames play the same ticks as 60 Hz frames', () =>
    Effect.gen(function* () {
      const at60 = yield* playFor(4, 60)
      const at120 = yield* playFor(4, 120)
      expect(firstDifference(worldOf(at60), worldOf(at120))).toBe(undefined)
    }),
  )

  it.effect('30 Hz frames play the same ticks as 60 Hz frames', () =>
    Effect.gen(function* () {
      const at60 = yield* playFor(4, 60)
      const at30 = yield* playFor(4, 30)
      expect(firstDifference(worldOf(at60), worldOf(at30))).toBe(undefined)
    }),
  )

  it.effect('a 60 Hz frame is one tick and leaves no carry', () =>
    Effect.map(playFor(4, 60), at60 => {
      expect(at60.stepCarryMs).toBe(0)
      expect(at60.elapsedMs).toBeGreaterThan(0)
    }),
  )
})
