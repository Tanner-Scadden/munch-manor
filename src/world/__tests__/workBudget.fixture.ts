import { Array, Function, pipe } from 'effect'

import type { Model, Zombie } from '#app/model.ts'
import { withActors } from '#test/model.fixture.ts'
import { zombieAt } from '#test/testing.ts'
import { levelOf } from '#world/level/arena.ts'
import { isInsideRoomAt, isSolidAt } from '#world/level/tileQueries.ts'
import { focusOf } from '#world/party/party.ts'

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
