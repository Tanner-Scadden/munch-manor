import { Array, Function, Option, Result } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import {
  type Box,
  type Level,
  START_LEVEL,
  type Tile,
  tileBox,
} from '../level/arena'
import {
  type LevelSpec,
  type RoomSpec,
  roomSpotsOf,
  widthOf,
} from '../level/plan'
import type { DisplayCase, Vector } from '../schema/worldSchema'

// Where the display cases stand (src/world/feats/cases.ts): their spots on
// the rooms' maps, their boxes and feet, and whether a case's room is open.
// Apart from the cases' rules so the dare (src/world/dare/dare.ts) can read
// where a case stands with no import cycle.

// THE SPOTS

// NOTE: how a case looks: a gun rack on the wall, a glass display case, or
// a trophy case. Only the drawing reads it.
export type CaseLook = 'Rack' | 'Glass' | 'Trophy'

// NOTE: `isNear` spots sit by the start and draw from the easier pool. A
// spot is the run of tiles a room's map marks for it (`cc`), left to right.
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

// NOTE: a level's case spots, read off its rooms' maps (roomSpotsOf in
// src/world/level/plan.ts), in room order: every `cc` of the room a run
// starts in (the dining room's three, docs/ROOM_DRAFTS.md), then the first
// of each other room, the kitchen and each slot's, so wherever a room
// stands its case stands with it. The count and which are near never
// change with the arrangement, so a run rolls its cases before its rooms
// are placed. A level keeps its spots, so a frame only reads them.
const caseSpotsOf = (spec: LevelSpec): ReadonlyArray<CaseSpot> => {
  const cached = spotsBySpec.get(spec)
  if (cached !== undefined) {
    return cached
  }
  const pieces = Array.flatMap(roomSpotsOf(spec), ({ room, cases }) => {
    const isNear = Option.exists(
      Array.findFirst(spec.rooms, ({ id }) => id === room),
      roomSpec => isStartRoom(spec, roomSpec),
    )
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

// NOTE: the spots a run's cases are rolled for: the start level's, whose
// count and near ones every arrangement shares.
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

// NOTE: the id of the room a case stands in.
export const caseRoomOf: {
  (displayCase: DisplayCase): (level: Level) => string
  (level: Level, displayCase: DisplayCase): string
} = Function.dual(
  2,
  (level: Level, displayCase: DisplayCase): string =>
    spotOf(level, displayCase).room,
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

// NOTE: the floor point a case stands on, the middle of its tiles' bottom.
export const caseFootOf: {
  (displayCase: DisplayCase): (level: Level) => Vector
  (level: Level, displayCase: DisplayCase): Vector
} = Function.dual(2, (level: Level, displayCase: DisplayCase): Vector => {
  const box = caseBoxOf(level, displayCase)
  return { x: (box.left + box.right) / 2, y: box.bottom }
})

// NOTE: a case counts once its room is open.
export const isCaseShown: {
  (displayCase: DisplayCase): (level: Level) => boolean
  (level: Level, displayCase: DisplayCase): boolean
} = Function.dual(2, (level: Level, displayCase: DisplayCase): boolean =>
  Array.some(
    level.rooms,
    ({ id, isOpen }) => id === spotOf(level, displayCase).room && isOpen,
  ),
)
