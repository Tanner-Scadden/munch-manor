import { Array, Function, Option, Result } from 'effect'

import { TILE_SIZE } from '#shared/constants.ts'
import { type Level, START_LEVEL } from '#world/level/arena.ts'
import {
  type LevelSpec,
  type RoomSpec,
  roomSpotsOf,
  widthOf,
} from '#world/level/plan.ts'
import { type Box, type Tile, tileBox } from '#world/level/tileGrid.ts'
import type { DisplayCase, Vector } from '#world/schema/worldSchema.ts'

export type CaseLook = 'Rack' | 'Glass' | 'Trophy'

export type CaseSpot = Readonly<{
  tiles: Array.NonEmptyReadonlyArray<Tile>
  room: string
  look: CaseLook
  isNear: boolean
}>

const LOOKS: Array.NonEmptyReadonlyArray<CaseLook> = ['Rack', 'Glass', 'Trophy']

const isStartRoom = (spec: LevelSpec, room: RoomSpec): boolean => {
  const left = room.origin.column * TILE_SIZE
  const top = room.origin.row * TILE_SIZE
  return (
    spec.start.x >= left &&
    spec.start.x < left + widthOf(room.tiles) * TILE_SIZE &&
    spec.start.y >= top &&
    spec.start.y < top + room.tiles.length * TILE_SIZE
  )
}

const spotsBySpec = new WeakMap<LevelSpec, ReadonlyArray<CaseSpot>>()

const caseSpotsOf = (spec: LevelSpec): ReadonlyArray<CaseSpot> => {
  const cached = spotsBySpec.get(spec)
  if (cached !== undefined) {
    return cached
  }
  const roomsById = new Map<RoomSpec['id'], RoomSpec>()
  for (const roomSpec of spec.rooms) {
    if (!roomsById.has(roomSpec.id)) {
      roomsById.set(roomSpec.id, roomSpec)
    }
  }
  const pieces = Array.flatMap(roomSpotsOf(spec), ({ room, cases }) => {
    const roomSpec = roomsById.get(room)
    const isNear = roomSpec !== undefined && isStartRoom(spec, roomSpec)
    return Array.filterMap(isNear ? cases : Array.take(cases, 1), tiles =>
      Array.isReadonlyArrayNonEmpty(tiles)
        ? Result.succeed({ tiles, room, isNear })
        : Result.failVoid,
    )
  })
  const spots = Array.map(pieces, (piece, index): CaseSpot => ({
    ...piece,
    look: Option.getOrElse(
      Array.get(LOOKS, index % LOOKS.length),
      () => LOOKS[0],
    ),
  }))
  spotsBySpec.set(spec, spots)
  return spots
}

export const CASE_SPOTS: ReadonlyArray<CaseSpot> = caseSpotsOf(START_LEVEL.spec)

const NO_SPOT: CaseSpot = {
  tiles: [{ column: 0, row: 0 }],
  room: '',
  look: 'Rack',
  isNear: false,
}

const spotOf = (level: Level, displayCase: DisplayCase): CaseSpot =>
  Option.getOrElse(
    Array.get(caseSpotsOf(level.spec), displayCase.spot),
    () => NO_SPOT,
  )

export const caseBoxOf: {
  (displayCase: DisplayCase): (level: Level) => Box
  (level: Level, displayCase: DisplayCase): Box
} = Function.dual(2, (level: Level, displayCase: DisplayCase): Box => {
  const { tiles } = spotOf(level, displayCase)
  const first = tileBox(Array.headNonEmpty(tiles))
  const last = tileBox(Array.lastNonEmpty(tiles))
  return { ...first, right: last.right }
})

export const caseLookOf: {
  (displayCase: DisplayCase): (level: Level) => CaseLook
  (level: Level, displayCase: DisplayCase): CaseLook
} = Function.dual(
  2,
  (level: Level, displayCase: DisplayCase): CaseLook =>
    spotOf(level, displayCase).look,
)

export const caseFootOf: {
  (displayCase: DisplayCase): (level: Level) => Vector
  (level: Level, displayCase: DisplayCase): Vector
} = Function.dual(2, (level: Level, displayCase: DisplayCase): Vector => {
  const box = caseBoxOf(level, displayCase)
  return { x: (box.left + box.right) / 2, y: box.bottom }
})

export const isCaseShown: {
  (displayCase: DisplayCase): (level: Level) => boolean
  (level: Level, displayCase: DisplayCase): boolean
} = Function.dual(2, (level: Level, displayCase: DisplayCase): boolean =>
  Array.some(
    level.rooms,
    ({ id, isOpen }) => id === spotOf(level, displayCase).room && isOpen,
  ),
)
