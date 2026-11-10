// The escape's drafted rooms (docs/ROOM_DRAFTS.md) for the Rooms tab: each
// room's map as drafted, laid out with the game's own wall, door, and exit
// drawing and the room's art (src/render/room/), so the owner can review a
// room before it is playable. Nothing here is a game level: the maps are
// copies of the drafts, read only by the studio.
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
import { boardShapes, cobweb } from '../../src/render/room/roomFloor'
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
  type LevelSpec,
  levelFor,
  makeLevel,
  tilesWithSymbol,
} from '../../src/world/level/arena'

export type DraftRoomId = 'Dining' | 'Library' | 'Cellar'

// MAPS

const DINING_MAP: ReadonlyArray<string> = [
  '######KK###################NN#######',
  '######KK###################NN#######',
  'W............HHHHHHHHHH.......cc...#',
  'W.............2....................#',
  '#..................................#',
  '#..................................#',
  '#HHH.......i............i.......HHH#',
  '#HHH1...........................HHH#',
  '#..................................>',
  '#..........................3.......>',
  '#.......=========^^=========.......#',
  '#.......=========^^=========.......#',
  '<..................................#',
  '<..................................?',
  '#..........i.....@@.....i..........?',
  '#cc..............................cc#',
  '#..................................#',
  '?..................................#',
  '?............i........i............E',
  '#HH...............................4E',
  '#HH......tt......................HH#',
  '#####SS#########MMMM################',
]

const LIBRARY_MAP: ReadonlyArray<string> = [
  '##############nn################',
  '##############nn################',
  '#..............................#',
  '#..............................#',
  '#..BB..BB..BB......BB..BB..BB..#',
  '#..BB..BB..BB...g..BB..BB..BB..#',
  '#..BB..BB..BB..1...BB..BB..BB2.#',
  '#..............................#',
  '(..............................)',
  '(..............................)',
  '#...........dddddddd...........#',
  '#..........3dddddddd...........#',
  '#..............................#',
  '%..............................%',
  '%..BB..BB..BB......BB..BB..BB..%',
  '#..BB..BB..BB......BB..BB..BB..#',
  '#..BBccBBttBB......BB4.BBccBB..#',
  '################ss##############',
]

const CELLAR_MAP: ReadonlyArray<string> = [
  '#####nn#########################',
  '#####nn#########################',
  '#.....4........................#',
  '#..............................#',
  '#..]]]]]]]]..]]]]]]..]]]]]]]]..#',
  '#...........................2..#',
  '#..............................#',
  '#..]]]]]]]]....tt....]]]]]]]]..#',
  '(.............oooo.............)',
  '(.............oooo1............)',
  '#..]]]]]]]]...oooo...]]]]]]]]..#',
  '#.............oooo.............#',
  '#..............................#',
  '?..............................?',
  '?..]]]]]]]]..]]]]]]..]]]]]]]]..?',
  '#..........................3...#',
  '#cc..........................cc#',
  '#######################ss#######',
]

// NOTE: what each drafted symbol is drawn as. The digits, `@`, and `^` are
// review marks on bare floor.
const DINING_COVER: Readonly<Record<string, EscapeCoverKind>> = {
  '=': 'PartyTable',
  H: 'Hutch',
  i: 'Candelabra',
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
// marks as floor.
const WALL_MARKS = new Set(['M', '%', '?'])
const FLOOR_MARKS = new Set(['@', '^', '1', '2', '3', '4'])

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
  tiles: engineMapOf(map),
  topRow: 0,
  exits: Array.map(exits, ([exitId, symbol]) => ({
    id: exitId,
    symbol,
    doors: [],
  })),
  rooms: [
    {
      id,
      firstColumn: 0,
      lastColumn: Option.getOrElse(Array.head(map), () => '').length - 1,
      firstRow: 0,
      lastRow: map.length - 1,
      maybeExit: Option.none(),
    },
  ],
})

const DINING_SPEC = specOf('Dining', DINING_MAP, [
  ['Kitchen', 'K'],
  ['West', '<'],
  ['East', '>'],
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
    title: 'The dining room (draft)',
    map: DINING_MAP,
    maybeTwist: Option.some({
      label: 'Chandelier',
      off: 'Hung',
      on: 'Fallen',
    }),
  },
  Library: {
    id: 'Library',
    title: 'The library (draft)',
    map: LIBRARY_MAP,
    maybeTwist: Option.some({ label: 'Secret shelf', off: 'Shut', on: 'Open' }),
  },
  Cellar: {
    id: 'Cellar',
    title: 'The cellar (draft)',
    map: CELLAR_MAP,
    maybeTwist: Option.none(),
  },
}

export const DRAFT_ROOM_SOURCE =
  'the map: docs/ROOM_DRAFTS.md (copied in tools/studio/draftRooms.ts); the art: src/render/room/ (diningArt.ts, libraryArt.ts, cellarArt.ts, escapeCover.ts)'

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
    ...diningWallShapes(level),
    ...diningWallDecorShapes(room),
    ...doors(level),
    ...Option.match(symbolBoxOf(DINING_MAP, 'M'), {
      onNone: () => [],
      onSome: frontDoorShapes,
    }),
    ...escapeCoverShapes(level, DINING_COVER),
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

const libraryShapes = (isOpen: boolean): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(LIBRARY_SPEC)
  const room = roomBoxOf(level)
  const shelves = tilesWithSymbol(makeLevel(LIBRARY_MAP), '%')
  const westTop = Array.findFirst(shelves, ({ column }) => column === 0)
  const eastTop = Array.findFirst(shelves, ({ column }) => column > 0)
  return [
    ...boardShapes({
      width: level.width,
      height: level.height,
      tileCount: level.tileCount,
    }),
    ...libraryFloorShadeShapes(room),
    ...libraryRugShapes(room),
    ...walls(level),
    ...libraryWallShapes(level),
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
    ...cellarWallShapes(level),
    ...doors(level),
    ...escapeCoverShapes(level, CELLAR_COVER),
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
