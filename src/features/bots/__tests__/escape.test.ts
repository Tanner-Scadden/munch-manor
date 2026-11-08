import { describe, expect, test } from 'vitest'

import { PARLOUR } from '../../../world/level/arena'
import { escapeHeading } from '../escape'

// Which way a bot runs from zombies (src/features/bots/escape.ts): never into the wall or
// the corner behind it.

const dot = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x * b.x + a.y * b.y

describe('escapeHeading', () => {
  test('with no zombie near, it stays put', () => {
    expect(escapeHeading(PARLOUR, { x: 160, y: 95 }, [])).toEqual({
      x: 0,
      y: 0,
    })
  })

  test('in the open, it runs away from the zombie', () => {
    const heading = escapeHeading(PARLOUR, { x: 160, y: 95 }, [
      { at: { x: 140, y: 95 }, radius: 5 },
    ])
    expect(heading.x).toBeGreaterThan(0.7)
  })

  test('with its back to a wall, it slides along the wall instead of into it', () => {
    const heading = escapeHeading(PARLOUR, { x: 160, y: 165 }, [
      { at: { x: 160, y: 140 }, radius: 5 },
    ])
    expect(Math.abs(heading.x)).toBeGreaterThan(0.7)
  })

  test('with a zombie coming into a corner, it runs out along a wall, not into the corner', () => {
    const intoCorner = { x: -Math.SQRT1_2, y: Math.SQRT1_2 }
    const heading = escapeHeading(PARLOUR, { x: 25, y: 155 }, [
      { at: { x: 50, y: 130 }, radius: 5 },
    ])
    expect(dot(heading, intoCorner)).toBeLessThan(0.5)
  })

  test('boxed in a corner, it slips out between two zombies rather than through one', () => {
    const from = { x: 16, y: 164 }
    const right = { at: { x: 40, y: 164 }, radius: 5 }
    const above = { at: { x: 16, y: 140 }, radius: 5 }
    const heading = escapeHeading(PARLOUR, from, [right, above])
    expect(heading.x).toBeGreaterThan(0.3)
    expect(heading.y).toBeLessThan(-0.3)
  })
})
