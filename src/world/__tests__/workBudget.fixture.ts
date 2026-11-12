import { Array, Function, pipe } from 'effect'

import type { Model, Zombie } from '../../app/model'
import { withActors } from '../../test/model.fixture'
import { zombieAt } from '../../test/testing'
import { levelOf } from '../level/arena'
import { isInsideRoomAt, isSolidAt } from '../level/tileQueries'
import { focusOf } from '../party/party'

// NOTE: open floor around the player, a body's width apart and clear of
// their reach, in reading order, so a crowd of any size stands spread out
// as a wave's would, rather than in one heap.
const SPACING_PX = 22
const CLEAR_OF_PLAYER_PX = 70
const REACH_PX = 260

const openSpotsAround = (
  model: Model,
): ReadonlyArray<Readonly<{ x: number; y: number }>> => {
  const level = levelOf(model)
  const { x, y } = focusOf(model).player
  const offsets = Array.makeBy(
    Math.floor((REACH_PX * 2) / SPACING_PX),
    step => step * SPACING_PX - REACH_PX,
  )
  return pipe(
    offsets,
    Array.flatMap(down =>
      Array.map(offsets, across => ({ x: x + across, y: y + down })),
    ),
    Array.filter(
      spot =>
        Math.hypot(spot.x - x, spot.y - y) > CLEAR_OF_PLAYER_PX &&
        isInsideRoomAt(level, spot) &&
        !isSolidAt(level, spot),
    ),
  )
}

// NOTE: a quiet wave 3 with `count` Groaners on the open floor around the
// player, nothing else coming in.
export const crowdOf: {
  (count: number): (base: Model) => Model
  (base: Model, count: number): Model
} = Function.dual(2, (base: Model, count: number): Model => {
  const spots = openSpotsAround(base)
  const zombies: ReadonlyArray<Zombie> = Array.map(
    Array.take(spots, count),
    (spot, index) => zombieAt(index + 1, spot.x, spot.y),
  )
  return withActors(base, zombies)
})
