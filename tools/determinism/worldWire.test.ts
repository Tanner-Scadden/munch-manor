// The World on the binary wire (src/worldCodec.ts), in single player: a
// snapshot reads back as the World, and a client that applies every diff
// holds what a snapshot of the room's World gives. The co-op room's own
// round trips are in src/roomWorld.test.ts.

import { Array, Struct } from 'effect'
import { describe, expect, test } from 'vitest'

import { makeReader, makeWriter } from '../../packages/netcode/src/Wire'
import { refreshIntent } from '../../src/frame'
import { focusOf } from '../../src/party'
import { soloInputs, stepWorld } from '../../src/stepWorld'
import { WORLD_KEYS } from '../../src/testing'
import type { World } from '../../src/world'
import {
  isSameOnWire,
  readWorld,
  readWorldDiff,
  writeWorld,
  writeWorldDiff,
} from '../../src/worldCodec'
import { firstDifference } from './diff'
import { playFrame, startedRun } from './script'

const roundTrip = (world: World): World => {
  const writer = makeWriter()
  writeWorld(writer, world)
  return readWorld(makeReader(writer.finish()))
}

describe('the World on the wire', () => {
  test('diffs applied every third tick hold what a snapshot holds', () => {
    const played = Array.reduce(
      globalThis.Array.from({ length: 600 }),
      startedRun(2, 'Campaign'),
      (model: ReturnType<typeof startedRun>, _, frame) =>
        playFrame(model, frame, 'Fixed60'),
    )
    const intended = refreshIntent(played)
    const start: World = Struct.pick(intended, WORLD_KEYS)
    const room = Array.reduce(
      globalThis.Array.from({ length: 180 }),
      { world: start, sent: start, client: roundTrip(start) },
      ({ world, sent, client }, _, tick) => {
        const next = stepWorld(
          world,
          soloInputs(focusOf(intended).intent),
        ).world
        if (tick % 3 !== 2) {
          return { world: next, sent, client }
        }
        const writer = makeWriter()
        writeWorldDiff(writer, sent, next)
        return {
          world: next,
          sent: next,
          client: readWorldDiff(makeReader(writer.finish()), client),
        }
      },
    )
    expect(firstDifference(roundTrip(room.world), room.client)).toBe(undefined)
    expect(isSameOnWire(room.client, room.world)).toBe(true)
    expect(room.client.elapsedMs).toBeGreaterThan(start.elapsedMs)
  })

  test('an unchanged World diffs to one byte', () => {
    const world = Struct.pick(startedRun(1, 'Campaign'), WORLD_KEYS)
    const writer = makeWriter()
    writeWorldDiff(writer, world, world)
    expect(writer.finish().length).toBe(1)
  })
})
