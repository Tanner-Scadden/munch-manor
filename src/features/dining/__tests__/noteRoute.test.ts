import { Array, Option, Result } from 'effect'
import { expect, test } from 'vitest'

import { levelFor, roomAt } from '../../../world/level/arena'
import {
  ARRANGEMENTS,
  DINING_ROOM_ID,
  PARLOUR_ROOM_ID,
  manorSpecFor,
  roomSpotsOf,
} from '../../../world/level/plan'
import { distanceToBox, tileBox } from '../../../world/level/tileGrid'
import { isSolidAt } from '../../../world/level/tileQueries'
import type { Vector } from '../../../world/schema/worldSchema'
import { stationCenterOf } from '../../../world/stations/stationSpots'
import { type NoteRoute, noteRouteOf } from '../hubTouchView'

// The parlour's notes drift off the gramophone, out through the parlour's
// doorway, and a few tiles into the dining room, in every house the slots
// can make: through the middle of each doorway, clear of the walls, the
// furniture, and the display cases.

const EVERY_EXIT = ['West', 'East', 'Far', 'Kitchen'] as const

const houses = Array.map(ARRANGEMENTS, arrangement =>
  levelFor(manorSpecFor(arrangement), EVERY_EXIT),
)

// NOTE: past the gramophone itself, which stands among the parlour's
// furniture, every couple of pixels to the route's end.
const SKIP_PX = 10
const STEP_PX = 2

const pointsOf = (route: NoteRoute): ReadonlyArray<Vector> =>
  Array.flatMap(route.segments, ({ from, to, start, length }) =>
    Array.filterMap(
      Array.makeBy(Math.ceil(length / STEP_PX) + 1, step =>
        Math.min(length, step * STEP_PX),
      ),
      along =>
        start + along < SKIP_PX
          ? Result.failVoid
          : Result.succeed({
              x: from.x + ((to.x - from.x) * along) / length,
              y: from.y + ((to.y - from.y) * along) / length,
            }),
    ),
  )

const routeOf = (level: (typeof houses)[number]): NoteRoute =>
  Option.getOrThrow(noteRouteOf(level))

test('the route starts at the gramophone and ends a few tiles into the dining room', () => {
  Array.forEach(houses, level => {
    const route = routeOf(level)
    const first = Option.getOrThrow(Array.head(route.segments))
    const last = Option.getOrThrow(Array.last(route.segments))
    expect(first.from).toEqual(
      Option.getOrThrow(stationCenterOf(level, 'Gramophone')),
    )
    expect(roomAt(level, first.from).id).toBe(PARLOUR_ROOM_ID)
    expect(roomAt(level, last.to).id).toBe(DINING_ROOM_ID)
  })
})

test('the route keeps at least 6 pixels off every wall and piece of cover', () => {
  Array.forEach(houses, level => {
    Array.forEach(pointsOf(routeOf(level)), ({ x, y }) => {
      Array.forEach(
        [
          { x, y },
          { x: x - 6, y },
          { x: x + 6, y },
          { x, y: y - 6 },
          { x, y: y + 6 },
        ],
        point => expect(isSolidAt(level, point), `${x},${y}`).toBe(false),
      )
    })
  })
})

test('the route keeps well clear of every display case', () => {
  Array.forEach(houses, level => {
    const caseTiles = Array.flatMap(roomSpotsOf(level.spec), ({ cases }) =>
      Array.flatten(cases),
    )
    Array.forEach(pointsOf(routeOf(level)), point => {
      Array.forEach(caseTiles, tile => {
        expect(distanceToBox(point, tileBox(tile))).toBeGreaterThan(15)
      })
    })
  })
})
