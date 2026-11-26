import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { PLAYER_RADIUS } from '#shared/constants.ts'
import { quietWave, withPlayerAt } from '#test/model.fixture.ts'
import { levelOf, openExitIn } from '#world/level/arena.ts'
import { KITCHEN_EXIT } from '#world/level/exits.ts'
import {
  EAST_EXIT,
  FAR_EXIT,
  SECRET_EXIT,
  WEST_EXIT,
} from '#world/level/plan.ts'
import { type Box, boxCenter } from '#world/level/tileGrid.ts'
import { isSolidAt } from '#world/level/tileQueries.ts'
import type { StationId, Vector } from '#world/schema/worldSchema.ts'
import { stationBoxOf } from '#world/stations/stationSpots.ts'
import { TOOL_RULES } from '#world/stations/toolRules.ts'

const EXITS = [KITCHEN_EXIT, WEST_EXIT, EAST_EXIT, FAR_EXIT, SECRET_EXIT]

export const openHouse = (model: Model): Model =>
  UiStruct.evolve(model, {
    level: state =>
      Array.reduce(EXITS, state, (open, exit) => openExitIn(open, exit)),
  })

export const houseWave: Model = openHouse(quietWave(4))

export const toolBoxOf: {
  (id: StationId): (model: Model) => Box
  (model: Model, id: StationId): Box
} = Function.dual(2, (model: Model, id: StationId): Box =>
  Option.getOrThrow(stationBoxOf(levelOf(model), id)),
)

export const roomBoxOf: {
  (room: string): (model: Model) => Box
  (model: Model, room: string): Box
} = Function.dual(2, (model: Model, room: string): Box =>
  Option.getOrThrow(
    Option.map(
      Array.findFirst(levelOf(model).rooms, ({ id }) => id === room),
      ({ box }) => box,
    ),
  ),
)

const BODY_EDGES: ReadonlyArray<Vector> = [
  { x: 0, y: 0 },
  { x: PLAYER_RADIUS, y: 0 },
  { x: -PLAYER_RADIUS, y: 0 },
  { x: 0, y: PLAYER_RADIUS },
  { x: 0, y: -PLAYER_RADIUS },
]

const isClearAt = (model: Model, point: Vector): boolean =>
  !Array.some(BODY_EDGES, edge =>
    isSolidAt(levelOf(model), { x: point.x + edge.x, y: point.y + edge.y }),
  )

export const spotAtTool: {
  (id: StationId): (model: Model) => Vector
  (model: Model, id: StationId): Vector
} = Function.dual(2, (model: Model, id: StationId): Vector => {
  const box = toolBoxOf(model, id)
  const { x, y } = boxCenter(box)
  const gap = PLAYER_RADIUS + 1
  return Option.getOrThrow(
    Array.findFirst(
      [
        { x, y: box.bottom + gap },
        { x, y: box.top - gap },
        { x: box.left - gap, y },
        { x: box.right + gap, y },
      ],
      point => isClearAt(model, point),
    ),
  )
})

export const atTool: {
  (id: StationId): (model: Model) => Model
  (model: Model, id: StationId): Model
} = Function.dual(2, (model: Model, id: StationId): Model => {
  const { x, y } = spotAtTool(model, id)
  return withPlayerAt(model, x, y)
})

export const firedAgo: {
  (id: StationId, agoMs: number): (model: Model) => Model
  (model: Model, id: StationId, agoMs: number): Model
} = Function.dual(3, (model: Model, id: StationId, agoMs: number): Model =>
  UiStruct.evolve(model, {
    stations: stations => ({
      ...stations,
      [id]: {
        workedMs: 0,
        cooldownMs: TOOL_RULES[id].cooldownMs - agoMs,
        timesWorked: 1,
      },
    }),
  }),
)
