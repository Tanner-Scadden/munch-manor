// The escape's rooms one at a time for the Rooms tab: each room's map from
// src/world/level/plan.ts, laid out alone with the game's own wall, door,
// and exit drawing and the room's art (src/render/room/), so the owner can
// review a room's shape up close.
import { Array, Function, Option, String, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import { bakeShapes, placeAt } from '../../src/art/sprite'
import {
  CELLAR_BULB_SHAPES,
  cellarFloorShapes,
  cellarWallShapes,
  coalHeapShapes,
  looseStoneShapes,
  oddBottleShapes,
} from '../../src/render/room/cellarArt'
import {
  CHANDELIER_SHAPES,
  diningFloorShapes,
  diningRugShapes,
  diningWallDecorShapes,
  diningWallShapes,
  frontDoorShapes,
  umbrellaStandShapes,
} from '../../src/render/room/diningArt'
import {
  type EscapeCoverKind,
  escapeCoverShapes,
} from '../../src/render/room/escapeCover'
import {
  SHELF_SHAPES,
  ladderShapes,
  libraryFloorShadeShapes,
  libraryRugShapes,
  libraryWallDecorShapes,
  libraryWallShapes,
} from '../../src/render/room/libraryArt'
import { allCoverShapes } from '../../src/render/room/roomCover'
import {
  PARLOUR_RUG,
  boardShapes,
  cobweb,
  rugShapes,
} from '../../src/render/room/roomFloor'
import {
  type Box,
  FACE_TOP,
  boundingBox,
} from '../../src/render/room/roomPalette'
import {
  closedExitShapes,
  doorwayShapes,
  wallShadowShapes,
  wallShapes,
} from '../../src/render/room/roomWalls'
import { TILE_SIZE } from '../../src/shared/constants'
import {
  type Level,
  levelFor,
  makeLevel,
  tilesWithSymbol,
} from '../../src/world/level/arena'
import {
  CELLAR_MAP,
  DINING_MAP,
  LIBRARY_MAP,
  type LevelSpec,
  PARLOUR_SLOT_MAP,
  middleOf,
} from '../../src/world/level/plan'

export type DraftRoomId = 'Dining' | 'Parlour' | 'Library' | 'Cellar'

// MAPS

// NOTE: what each drafted symbol is drawn as. The digits, `@`, and `^` are
// review marks on bare floor.
const DINING_COVER: Readonly<Record<string, EscapeCoverKind>> = {
  '=': 'PartyTable',
  H: 'Hutch',
  i: 'Candelabra',
  c: 'DisplayCase',
  t: 'TrapCrate',
}

const PARLOUR_COVER: Readonly<Record<string, EscapeCoverKind>> = {
  c: 'DisplayCase',
  t: 'TrapCrate',
}

const LIBRARY_COVER: Readonly<Record<string, EscapeCoverKind>> = {
  B: 'BookStack',
  d: 'Desk',
  g: 'Globe',
  c: 'DisplayCase',
  t: 'TrapCrate',
}

const CELLAR_COVER: Readonly<Record<string, EscapeCoverKind>> = {
  ']': 'WineRack',
  o: 'Barrels',
  c: 'DisplayCase',
  t: 'TrapCrate',
}

// NOTE: the drafted map as the game's walls and doors read it: a slot
// room's spawn doors drawn as the parlour's North and South, the front door
// and the secret shelves as wall (their art goes over it), and the review
// marks as floor (`*`, a room tool's tile to come, too). The chandelier's
// gap, `^`, stays: the party table finds its halves by it, and it is floor
// while the chandelier hangs. The cleat, `j`, is wall.
const WALL_MARKS = new Set(['M', '%', '?', 'j'])
const FLOOR_MARKS = new Set(['@', '1', '2', '3', '4', '*'])

const engineMapOf = (map: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(map, line =>
    pipe(
      String.split('')(line),
      Array.map(symbol =>
        WALL_MARKS.has(symbol)
          ? '#'
          : FLOOR_MARKS.has(symbol)
            ? '.'
            : symbol === 'n'
              ? 'N'
              : symbol === 's'
                ? 'S'
                : symbol,
      ),
      Array.join(''),
    ),
  )

// NOTE: the boarded exits, shut, as the room's walls draw them.
const specOf = (
  id: DraftRoomId,
  map: ReadonlyArray<string>,
  exits: ReadonlyArray<readonly [string, string]>,
): LevelSpec => ({
  id: `Draft${id}`,
  rooms: [
    {
      id,
      tiles: engineMapOf(map),
      origin: { column: 0, row: 0 },
      maybeExit: Option.none(),
      renames: {},
    },
  ],
  exits: Array.map(exits, ([exitId, symbol]) => ({
    id: exitId,
    symbol,
    doors: [],
    opener: 'Boards',
    requires: [],
  })),
  drops: [],
  start: middleOf(map),
})

const DINING_SPEC = specOf('Dining', DINING_MAP, [
  ['Kitchen', 'K'],
  ['West', '<'],
  ['East', '>'],
])
const PARLOUR_SPEC = specOf('Parlour', PARLOUR_SLOT_MAP, [
  ['West', '('],
  ['East', ')'],
])
const LIBRARY_SPEC = specOf('Library', LIBRARY_MAP, [
  ['West', '('],
  ['East', ')'],
])
const CELLAR_SPEC = specOf('Cellar', CELLAR_MAP, [
  ['West', '('],
  ['East', ')'],
])

// ROOMS

export type DraftRoom = Readonly<{
  id: DraftRoomId
  title: string
  map: ReadonlyArray<string>
  // NOTE: the toggle's name and its two words, when the room has a twist to
  // show both ways.
  maybeTwist: Option.Option<
    Readonly<{ label: string; off: string; on: string }>
  >
}>

export const DRAFT_ROOMS: Readonly<Record<DraftRoomId, DraftRoom>> = {
  Dining: {
    id: 'Dining',
    title: 'The dining room',
    map: DINING_MAP,
    maybeTwist: Option.some({
      label: 'Chandelier',
      off: 'Hung',
      on: 'Fallen',
    }),
  },
  Parlour: {
    id: 'Parlour',
    title: 'The parlour',
    map: PARLOUR_SLOT_MAP,
    maybeTwist: Option.none(),
  },
  Library: {
    id: 'Library',
    title: 'The library',
    map: LIBRARY_MAP,
    maybeTwist: Option.some({ label: 'Secret shelf', off: 'Shut', on: 'Open' }),
  },
  Cellar: {
    id: 'Cellar',
    title: 'The cellar',
    map: CELLAR_MAP,
    maybeTwist: Option.none(),
  },
}

export const DRAFT_ROOM_SOURCE =
  'the map: src/world/level/plan.ts; the art: src/render/room/ (diningArt.ts, libraryArt.ts, cellarArt.ts, escapeCover.ts, roomCover.ts)'

const roomBoxOf = (level: Level): Box => ({
  x: 0,
  y: 0,
  width: level.width,
  height: level.height,
})

const cornerCobwebs = (room: Box): ReadonlyArray<Canvas.Shape> => [
  ...cobweb(room.x + TILE_SIZE, room.y + FACE_TOP + 1, true, true),
  ...cobweb(
    room.x + room.width - TILE_SIZE,
    room.y + FACE_TOP + 1,
    false,
    true,
  ),
  ...cobweb(room.x + TILE_SIZE, room.y + room.height - TILE_SIZE, true, false),
  ...cobweb(
    room.x + room.width - TILE_SIZE,
    room.y + room.height - TILE_SIZE,
    false,
    false,
  ),
]

// NOTE: the box a symbol's tiles cover on the drafted map, in world pixels.
const symbolBoxOf = (
  map: ReadonlyArray<string>,
  symbol: string,
): Option.Option<Box> =>
  pipe(
    tilesWithSymbol(makeLevel(map), symbol),
    Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
    Option.map(boundingBox),
  )

const walls = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...wallShadowShapes(level),
  ...wallShapes(level),
]

const doors = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...closedExitShapes(level),
  ...doorwayShapes(level),
]

const diningShapes = (isFallen: boolean): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(DINING_SPEC)
  const room = roomBoxOf(level)
  return [
    ...diningFloorShapes(room),
    ...diningRugShapes(room),
    ...walls(level),
    ...diningWallShapes(level, room),
    ...diningWallDecorShapes(room),
    ...doors(level),
    ...Option.match(symbolBoxOf(DINING_MAP, 'M'), {
      onNone: () => [],
      onSome: frontDoorShapes,
    }),
    ...escapeCoverShapes(level, DINING_COVER),
    ...allCoverShapes(level),
    ...umbrellaStandShapes(room),
    ...Option.match(symbolBoxOf(DINING_MAP, '^'), {
      onNone: () => [],
      onSome: gap => [
        placeAt(
          gap.x + gap.width / 2,
          gap.y + (isFallen ? gap.height / 2 : 0),
          CHANDELIER_SHAPES[isFallen ? 'Fallen' : 'Hung'],
        ),
      ],
    }),
    ...cornerCobwebs(room),
  ]
}

const parlourShapes = (): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(PARLOUR_SPEC)
  const room = roomBoxOf(level)
  return [
    ...boardShapes({
      x: 0,
      y: 0,
      width: level.width,
      height: level.height,
      tileCount: level.tileCount,
    }),
    ...rugShapes(PARLOUR_RUG),
    ...walls(level),
    ...doors(level),
    ...escapeCoverShapes(level, PARLOUR_COVER),
    ...allCoverShapes(level),
    ...cornerCobwebs(room),
  ]
}

const libraryShapes = (isOpen: boolean): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(LIBRARY_SPEC)
  const room = roomBoxOf(level)
  const shelves = tilesWithSymbol(makeLevel(LIBRARY_MAP), '%')
  const westTop = Array.findFirst(shelves, ({ column }) => column === 0)
  const eastTop = Array.findFirst(shelves, ({ column }) => column > 0)
  return [
    ...boardShapes({
      x: 0,
      y: 0,
      width: level.width,
      height: level.height,
      tileCount: level.tileCount,
    }),
    ...libraryFloorShadeShapes(room),
    ...libraryRugShapes(room),
    ...walls(level),
    ...libraryWallShapes(level, room),
    ...libraryWallDecorShapes(room),
    ...doors(level),
    ...Option.match(westTop, {
      onNone: () => [],
      onSome: ({ column, row }) => [
        placeAt(
          column * TILE_SIZE,
          row * TILE_SIZE,
          SHELF_SHAPES.West[isOpen ? 'Open' : 'Shut'],
        ),
      ],
    }),
    ...Option.match(eastTop, {
      onNone: () => [],
      onSome: ({ column, row }) => [
        placeAt(column * TILE_SIZE, row * TILE_SIZE, SHELF_SHAPES.East.Shut),
      ],
    }),
    ...escapeCoverShapes(level, LIBRARY_COVER),
    ...ladderShapes(room),
    ...cornerCobwebs(room),
  ]
}

const cellarShapes = (): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(CELLAR_SPEC)
  const room = roomBoxOf(level)
  return [
    ...cellarFloorShapes(room),
    ...coalHeapShapes(room),
    ...looseStoneShapes(room),
    ...walls(level),
    ...cellarWallShapes(level, room),
    ...doors(level),
    ...escapeCoverShapes(level, CELLAR_COVER),
    ...allCoverShapes(level),
    ...oddBottleShapes(room),
    placeAt(room.x + 160, room.y + 52, CELLAR_BULB_SHAPES),
    ...cornerCobwebs(room),
    ...cobweb(room.x + 30, room.y + 31, true, true),
    ...cobweb(room.x + 290, room.y + 61, false, true),
    ...cobweb(room.x + 30, room.y + 131, true, true),
  ]
}

const ROOM_DRAWINGS: Readonly<
  Record<DraftRoomId, (isTwistOn: boolean) => ReadonlyArray<Canvas.Shape>>
> = {
  Dining: diningShapes,
  Parlour: parlourShapes,
  Library: libraryShapes,
  Cellar: cellarShapes,
}

const builtRooms = new Map<string, ReadonlyArray<Canvas.Shape>>()

// NOTE: a drafted room as one baked image, with its twist one way or the
// other, built once and kept.
export const draftRoomShapes: {
  (isTwistOn: boolean): (room: DraftRoom) => ReadonlyArray<Canvas.Shape>
  (room: DraftRoom, isTwistOn: boolean): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (room: DraftRoom, isTwistOn: boolean): ReadonlyArray<Canvas.Shape> => {
    const key = `${room.id}:${isTwistOn ? 'on' : 'off'}`
    const cached = builtRooms.get(key)
    if (cached !== undefined) {
      return cached
    }
    const shapes = bakeShapes(ROOM_DRAWINGS[room.id](isTwistOn))
    builtRooms.set(key, shapes)
    return shapes
  },
)
