import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { DOOR_HALF_WIDTH_PX, FIXED_STEP_MS } from '../../../shared/constants'
import {
  quietWave,
  withActors,
  withPlayerAt,
} from '../../../test/model.fixture'
import { APPLICATION, recordTicks, zombieAt } from '../../../test/testing'
import { doorSpawnPoint, isInsideRoomAt, levelOf, openExitIn } from '../arena'
import { KITCHEN_EXIT } from '../exits'

// NOTE: the kitchen open, the player inside its west window, and a zombie
// due at the dining room's west door just below it. The flow field's way in
// for that zombie runs out through the yard and in at the window, nearer the
// player: steering by the field alone walked it there out of sight.
const kitchenOpen: Model = modifyFields(quietWave(3), {
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

// NOTE: the doorway's lane, from the door's outer face out past the spawn
// point, no wider than the door and a little give.
const LANE_HALF_WIDTH_PX = DOOR_HALF_WIDTH_PX + 5
const LANE_OUT_PX = 25

const isInWestLane = ({ x, y }: Readonly<{ x: number; y: number }>): boolean =>
  Math.abs(y - WEST.edge.y) <= LANE_HALF_WIDTH_PX &&
  x >= WEST.edge.x - LANE_OUT_PX

describe('a zombie at its door', () => {
  it.effect('walks in through that door, not round the yard to another', () =>
    Effect.gen(function* () {
      const frames: Array<Model> = []
      yield* Story.story(
        APPLICATION,
        Story.given(
          withActors(
            withPlayerAt(kitchenOpen, BY_THE_WINDOW.x, BY_THE_WINDOW.y),
            [zombieAt(1, AT_THE_WEST_DOOR.x, AT_THE_WEST_DOOR.y)],
          ),
        ),
        ...recordTicks(90, FIXED_STEP_MS, frames),
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
