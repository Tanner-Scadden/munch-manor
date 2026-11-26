import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import {
  OPEN_GATE,
  framePaceOf,
  gateFrame,
  gateMenuFrame,
} from '#app/frame/frameGate.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { home, playingModel, readyModel } from '#test/model.fixture.ts'
import { Phase } from '#world/schema/worldSchema.ts'

const sentOver = (
  hz: number,
  gateOf: typeof gateFrame = gateFrame,
): ReadonlyArray<number> => {
  const deltaMs = 1000 / hz
  const sent: Array<number> = []
  Array.reduce(Array.range(1, hz), OPEN_GATE, gate => {
    const gated = gateOf(gate, deltaMs)
    Option.map(gated.sendMs, ms => sent.push(ms))
    return gated.gate
  })
  return sent
}

describe('the frame gate', () => {
  test('a 60 Hz screen sends every frame, each a tick', () => {
    const sent = sentOver(60)
    expect(sent).toHaveLength(60)
    Array.forEach(sent, ms => expect(ms).toBeCloseTo(FIXED_STEP_MS))
  })

  test.each([90, 120, 144, 165, 240])(
    'a %i Hz screen sends about 60 frames a second, never more',
    hz => {
      const sent = sentOver(hz)
      expect(sent.length).toBeLessThanOrEqual(61)
      expect(sent.length).toBeGreaterThanOrEqual(58)
    },
  )

  test('a 120 Hz screen sends every other frame with both their time', () => {
    const sent = sentOver(120)
    expect(sent).toHaveLength(60)
    Array.forEach(sent, ms => expect(ms).toBeCloseTo(FIXED_STEP_MS))
  })

  test('no time is lost: what it sends adds up to what it was given', () => {
    const sent = sentOver(90)
    const total = Array.reduce(sent, 0, (sum, ms) => sum + ms)
    expect(total).toBeGreaterThan(1000 - FIXED_STEP_MS)
    expect(total).toBeLessThanOrEqual(1000 + 1e-6)
  })

  test('a 60 Hz frame a little early still goes', () => {
    expect(
      Option.isSome(gateFrame(OPEN_GATE, FIXED_STEP_MS - 0.4).sendMs),
    ).toBe(true)
  })

  test('a long frame after a hidden tab goes at once', () => {
    expect(gateFrame(OPEN_GATE, 4000).sendMs).toStrictEqual(Option.some(4000))
  })
})

describe('the menu frame gate', () => {
  test.each([60, 90, 120, 144, 165, 240])(
    'a %i Hz screen sends about 30 frames a second on a menu, never more',
    hz => {
      const sent = sentOver(hz, gateMenuFrame)
      expect(sent.length).toBeLessThanOrEqual(30)
      expect(sent.length).toBeGreaterThanOrEqual(27)
    },
  )

  test('a 60 Hz screen jittering round its frame still sends every other', () => {
    const deltas = Array.flatten(
      Array.replicate([15.9, 17.4, 16.2, 1000 / 15 - 49.5], 15),
    )
    const sent: Array<number> = []
    Array.reduce(deltas, OPEN_GATE, (gate, deltaMs) => {
      const gated = gateMenuFrame(gate, deltaMs)
      Option.map(gated.sendMs, ms => sent.push(ms))
      return gated.gate
    })
    expect(sent).toHaveLength(30)
  })

  test('no time is lost on a menu either', () => {
    const sent = sentOver(144, gateMenuFrame)
    const total = Array.reduce(sent, 0, (sum, ms) => sum + ms)
    expect(total).toBeGreaterThan(1000 - 40)
    expect(total).toBeLessThanOrEqual(1000 + 1e-6)
  })
})

describe('the frame pace', () => {
  test('the title and the menus and lobbies over it go at a menu pace', () => {
    expect(framePaceOf(home)).toBe('Menu')
    expect(framePaceOf(readyModel)).toBe('Menu')
  })

  test('a run and its end card go at play pace', () => {
    expect(framePaceOf(playingModel)).toBe('Play')
    expect(
      framePaceOf(
        UiStruct.evolve(playingModel, {
          phase: () => Phase.GameOver({ wave: 1 }),
        }),
      ),
    ).toBe('Play')
  })
})
