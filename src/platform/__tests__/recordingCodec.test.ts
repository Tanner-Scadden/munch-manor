import { Array, Option, String } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  type TickInputs,
  encodeChunk,
  lineOfTick,
  tickOfLine,
  ticksOfChunks,
} from '../recordingCodec'

const aiming: TickInputs = {
  isCleared: false,
  inputs: [
    [
      0,
      {
        move: { x: 0.7071067811865476, y: -0 },
        maybeAim: Option.some({ x: -0.1234567890123456, y: 1e-17 }),
        trigger: 'Held',
        interact: 'Released',
      },
    ],
    [
      2,
      {
        move: { x: 0, y: 0 },
        maybeAim: Option.none(),
        trigger: 'Released',
        interact: 'Held',
      },
    ],
  ],
}

const still: TickInputs = { isCleared: true, inputs: [] }

describe('the tick codec', () => {
  test('a line reads back to the same intents, bit for bit', () => {
    const line = lineOfTick(aiming)
    expect(line).toBe(
      '0:0.7071067811865476,-0,-0.1234567890123456,1e-17,H,R;2:0,0,_,_,R,H',
    )
    const read = Option.getOrThrow(tickOfLine(line))
    expect(read).toEqual(aiming)
    expect(Object.is(read.inputs[0]?.[1].move.y, -0)).toBe(true)
  })

  test('a cleared tick with no seat is just its mark', () => {
    expect(lineOfTick(still)).toBe('!')
    expect(tickOfLine('!')).toEqual(Option.some(still))
  })

  test('equal ticks in a row cost one line', () => {
    const lines = [
      ...Array.replicate(lineOfTick(aiming), 3),
      lineOfTick(still),
      lineOfTick(aiming),
    ]
    const chunk = encodeChunk(lines)
    expect(String.split(chunk, '\n')).toHaveLength(3)
    expect(ticksOfChunks([chunk, ''])).toEqual(
      Option.some([aiming, aiming, aiming, still, aiming]),
    )
  })

  test('a malformed chunk reads as none', () => {
    expect(ticksOfChunks(['0*!'])).toEqual(Option.none())
    expect(ticksOfChunks(['2*0:1,2,_,_,H'])).toEqual(Option.none())
    expect(ticksOfChunks(['x'])).toEqual(Option.none())
  })
})
