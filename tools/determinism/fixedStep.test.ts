// The fixed step (MULTIPLAYER.md, Phase 0, step 2): the world steps in
// whole 60 Hz ticks whatever the display's rate, so the same held inputs
// over the same time play the same game at 30, 60, and 120 Hz.

import { describe, expect, test } from 'vitest'

import { update } from '../../src/main'
import { Message } from '../../src/message'
import type { Model } from '../../src/model'
import { firstDifference } from './diff'
import { gameplayOf } from './fields'
import { startedRun } from './script'

const send = (model: Model, message: Message): Model =>
  update(model, message).model

const holding = (model: Model): Model =>
  send(
    send(
      send(model, Message.PressedKey({ code: 'KeyD' })),
      Message.MovedMouse({ clientX: 300, clientY: 40 }),
    ),
    Message.PressedPointer({
      pointerId: 1,
      device: 'Mouse',
      clientX: 300,
      clientY: 40,
    }),
  )

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

const playFor = (model: Model, seconds: number, hz: number): Model =>
  Array.from({ length: seconds * hz }).reduce<Model>(
    current => send(current, Message.TickedFrame({ deltaTime: 1000 / hz })),
    model,
  )

describe('the fixed step', () => {
  const started = holding(
    send(startedRun(3, 'Campaign'), Message.PressedKey({ code: 'Enter' })),
  )
  const at60 = playFor(started, 4, 60)

  test('120 Hz frames play the same ticks as 60 Hz frames', () => {
    expect(
      firstDifference(worldOf(at60), worldOf(playFor(started, 4, 120))),
    ).toBe(undefined)
  })

  test('30 Hz frames play the same ticks as 60 Hz frames', () => {
    expect(
      firstDifference(worldOf(at60), worldOf(playFor(started, 4, 30))),
    ).toBe(undefined)
  })

  test('a 60 Hz frame is one tick and leaves no carry', () => {
    expect(at60.stepCarryMs).toBe(0)
    expect(at60.elapsedMs).toBeGreaterThan(0)
  })
})
