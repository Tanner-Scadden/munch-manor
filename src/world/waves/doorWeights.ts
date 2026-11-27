import { Array, Result } from 'effect'

import { type Level, type Room, levelOf, roomAt } from '#world/level/arena.ts'
import type { Box } from '#world/level/tileGrid.ts'
import { isStanding } from '#world/party/party.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import type { World } from '#world/schema/world.ts'
import type { DoorId } from '#world/schema/worldSchema.ts'

const isInBox = (box: Box, { x, y }: Vector): boolean =>
  x >= box.left && x < box.right && y >= box.top && y < box.bottom

const overlaps = (
  fromA: number,
  toA: number,
  fromB: number,
  toB: number,
): boolean => Math.min(toA, toB) > Math.max(fromA, fromB)

const isBeside = (a: Box, b: Box): boolean =>
  ((a.right === b.left || b.right === a.left) &&
    overlaps(a.top, a.bottom, b.top, b.bottom)) ||
  ((a.bottom === b.top || b.bottom === a.top) &&
    overlaps(a.left, a.right, b.left, b.right))

const isNearRoom =
  (rooms: ReadonlyArray<Room>) =>
  (room: Room): boolean =>
    room.isOpen &&
    Array.some(
      rooms,
      ({ id, box }) => id === room.id || isBeside(box, room.box),
    )

const doorRoomsByLevel = new WeakMap<Level, ReadonlyMap<DoorId, number>>()

const doorRoomsOf = (level: Level): ReadonlyMap<DoorId, number> => {
  const cached = doorRoomsByLevel.get(level)
  if (cached !== undefined) {
    return cached
  }
  const rooms = new Map<DoorId, number>()
  for (const door of level.doorIds) {
    const { center } = level.doors[door]
    let mask = 0
    Array.forEach(level.rooms, ({ box }, index) => {
      if (isInBox(box, center)) {
        mask |= 1 << index
      }
    })
    rooms.set(door, mask)
  }
  doorRoomsByLevel.set(level, rooms)
  return rooms
}

export const nearDoorsOf = (world: World): ReadonlyArray<DoorId> => {
  const level = levelOf(world)
  const occupied = Array.filterMap(world.seats, ({ seat, player }) =>
    isStanding(seat) ? Result.succeed(roomAt(level, player)) : Result.failVoid,
  )
  const isNear = isNearRoom(occupied)
  const near = Array.reduce(level.rooms, 0, (mask, room, index) =>
    isNear(room) ? mask | (1 << index) : mask,
  )
  const doorRooms = doorRoomsOf(level)
  return Array.filter(
    level.doorIds,
    door => ((doorRooms.get(door) ?? 0) & near) !== 0,
  )
}
