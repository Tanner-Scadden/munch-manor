import { Array, Result } from 'effect'

import { type Box, type Room, levelOf, roomAt } from '../level/arena'
import { isStanding } from '../party/party'
import type { Vector } from '../schema/entitySchema'
import type { World } from '../schema/world'
import type { DoorId } from '../schema/worldSchema'

// NOTE: the spawn doors a wave weights 2:1 toward the players (owner,
// 2026-11-10, after the pacing report): the doors of every room a standing
// player is in, and of each open room that shares a wall with one. Read once
// as the break rolls the wave (beginPreparation), so the weights hold for the
// whole wave and replay the same from the same World. This bends "No rubber
// banding" in GAME_DESIGN.md on purpose: zombies come where the players are,
// never easier or harder for how a run is going.

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

export const nearDoorsOf = (world: World): ReadonlyArray<DoorId> => {
  const level = levelOf(world)
  const occupied = Array.filterMap(world.seats, ({ seat, player }) =>
    isStanding(seat) ? Result.succeed(roomAt(level, player)) : Result.failVoid,
  )
  const near = Array.filter(level.rooms, isNearRoom(occupied))
  return Array.filter(level.doorIds, door =>
    Array.some(near, ({ box }) => isInBox(box, level.doors[door].center)),
  )
}
