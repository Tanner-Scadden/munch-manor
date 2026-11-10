import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { makeReader, makeWriter } from '@munch/netcode'

import { FIXED_STEP_MS } from '../../../shared/constants'
import { playRoom } from '../../../test/roomTesting'
import {
  DEFAULT_ROOM_SETTINGS,
  type RoomWorld,
  introForRound,
  readRoomDiff,
  readRoomSnapshot,
  startRoomWorld,
  writeRoomDiff,
  writeRoomSnapshot,
} from '../../net/roomWorld'
import { maybePlayerAt } from '../../party/party'
import { Phase } from '../../schema/worldSchema'
import { ARRIVAL_MS, SLAM_MS, skipArrival, slamAtMs } from '../arrival'

// The intro's clock in a co-op room (src/world/run/arrival.ts): the room
// counts up to the slam for the whole crew, nothing moves while it does, and
// every client reads the slam on the same room tick.

const fullRoom = startRoomWorld([0, 1, 2], 7, {
  ...DEFAULT_ROOM_SETTINGS,
  intro: 'Full',
})

const SLAM_TICK = Math.ceil(ARRIVAL_MS.Full / FIXED_STEP_MS)

const isBreak = (room: RoomWorld): boolean =>
  Phase.isAnyOf(['Preparation'])(room.world.phase)

const readBack = (room: RoomWorld): RoomWorld => {
  const writer = makeWriter()
  writeRoomSnapshot(writer, room)
  return readRoomSnapshot(makeReader(writer.finish()))
}

const applyDiff = (client: RoomWorld, from: RoomWorld, to: RoomWorld) => {
  const writer = makeWriter()
  writeRoomDiff(writer, from, to)
  return readRoomDiff(makeReader(writer.finish()), client)
}

// NOTE: the room ticks with each client following it through the wire: one
// every tick, one every third, as a laggier client would. Each records the
// room tick it first read the first break on.
const followed = (() => {
  const clients = [
    { every: 1, at: fullRoom, copy: readBack(fullRoom), slamTick: -1 },
    { every: 3, at: fullRoom, copy: readBack(fullRoom), slamTick: -1 },
  ]
  const roomSlam = { tick: -1 }
  const xs: Array<number> = []
  playRoom(fullRoom, SLAM_TICK + 6, room => {
    if (roomSlam.tick < 0 && isBreak(room)) {
      roomSlam.tick = room.tick
    }
    if (!isBreak(room)) {
      xs.push(Option.getOrThrow(maybePlayerAt(room.world, 0)).player.x)
    }
    Array.forEach(clients, client => {
      if (room.tick % client.every !== 0) {
        return
      }
      client.copy = applyDiff(client.copy, client.at, room)
      client.at = room
      if (client.slamTick < 0 && isBreak(client.copy)) {
        client.slamTick = client.copy.tick
      }
    })
  })
  return { roomSlam: roomSlam.tick, clients, xs }
})()

describe('the intro in a room', () => {
  test('a room opens on the intro, and the slam starts its first break', () => {
    expect(fullRoom.world.phase).toEqual(
      Phase.Arriving({ elapsedMs: 0, cut: 'Full' }),
    )
    expect(followed.roomSlam).toBe(SLAM_TICK)
  })

  test('every client reads the slam on the room tick it came', () => {
    expect(followed.clients[0]?.slamTick).toBe(SLAM_TICK)
    expect(followed.clients[1]?.slamTick).toBe(Math.ceil(SLAM_TICK / 3) * 3)
  })

  test('nothing moves while the crew arrives, whatever the players press', () => {
    expect(Array.dedupe(followed.xs).length).toBe(1)
  })

  test('a crew of veterans gets the short cut, one newcomer the whole intro', () => {
    const veteran = { hasSeenIntro: true }
    const newcomer = { hasSeenIntro: false }
    expect(introForRound(1, [veteran, veteran, veteran])).toBe('Short')
    expect(introForRound(1, [veteran, newcomer, veteran])).toBe('Full')
    expect(introForRound(1, [newcomer])).toBe('Full')
  })

  test('a rematch plays the short cut, newcomers or not', () => {
    expect(introForRound(2, [{ hasSeenIntro: false }])).toBe('Short')
    expect(introForRound(3, [{ hasSeenIntro: true }])).toBe('Short')
  })
})

describe('skipping', () => {
  test('a skip jumps to the slam, and the slam is never skipped', () => {
    const skipped = skipArrival(fullRoom.world)
    expect(skipped.phase).toEqual(
      Phase.Arriving({ elapsedMs: slamAtMs('Full'), cut: 'Full' }),
    )
    expect(skipArrival(skipped)).toBe(skipped)
    expect(ARRIVAL_MS.Full - slamAtMs('Full')).toBe(SLAM_MS)
  })
})
