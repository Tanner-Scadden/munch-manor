import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import type { Model } from '#app/model.ts'
import { DOOR_HALF_WIDTH_PX, FIXED_STEP_MS } from '#shared/constants.ts'
import { quietWave, withActors, withPlayerAt } from '#test/model.fixture.ts'
import { modelAfter, recordTicks, zombieAt } from '#test/testing.ts'
import { levelOf, openExitIn } from '#world/level/arena.ts'
import { KITCHEN_EXIT } from '#world/level/exits.ts'
import { doorSpawnPoint, isInsideRoomAt } from '#world/level/tileQueries.ts'

const kitchenOpen: Model = UiStruct.evolve(quietWave(3), {
  level: state => openExitIn(state, KITCHEN_EXIT),
})
const LEVEL = levelOf(kitchenOpen)
const WEST = LEVEL.doors.West
const WINDOW = LEVEL.doors.Window
const BY_THE_WINDOW = {
  x: WINDOW.center.x - WINDOW.outward.x * 20,
  y: WINDOW.center.y - WINDOW.outward.y * 20,
}
const AT_THE_WEST_DOOR = doorSpawnPoint(LEVEL, 'West', 0)

const LANE_HALF_WIDTH_PX = DOOR_HALF_WIDTH_PX + 5
const LANE_OUT_PX = 25

const isInWestLane = ({ x, y }: Readonly<{ x: number; y: number }>): boolean =>
  Math.abs(y - WEST.edge.y) <= LANE_HALF_WIDTH_PX &&
  x >= WEST.edge.x - LANE_OUT_PX

describe('a zombie at its door', () => {
  it.effect('walks in through that door, not round the yard to another', () =>
    Effect.gen(function* () {
      const frames: Array<Model> = []
      yield* modelAfter(
        withActors(
          withPlayerAt(kitchenOpen, BY_THE_WINDOW.x, BY_THE_WINDOW.y),
          [zombieAt(1, AT_THE_WEST_DOOR.x, AT_THE_WEST_DOOR.y)],
        ),
        recordTicks(90, FIXED_STEP_MS, frames),
      )

      const track = Array.flatMap(frames, ({ zombies }) =>
        Array.map(
          Array.filter(zombies, ({ id }) => id === 1),
          ({ x, y }) => ({ x, y }),
        ),
      )
      const [outside, inside] = Array.span(
        track,
        spot => !isInsideRoomAt(LEVEL, spot),
      )
      const entry = Option.getOrThrow(Array.head(inside))
      expect(Array.every(outside, isInWestLane)).toBe(true)
      expect(
        Math.hypot(entry.x - WEST.center.x, entry.y - WEST.center.y),
      ).toBeLessThan(DOOR_HALF_WIDTH_PX + 5)
    }),
  )
})
