import { Array, Function, Option, Record, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapesWithin,
  group,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import { gapBoxOf, isChandelierDown } from '../../world/dining/chandelier'
import {
  type Exit,
  type Level,
  type Room,
  levelFor,
  levelOf,
  maybeExit,
} from '../../world/level/arena'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  LIBRARY_ROOM_ID,
  type LevelSpec,
  PARLOUR_ROOM_ID,
  SECRET_EXIT,
} from '../../world/level/plan'
import {
  type Box as ArenaBox,
  COVER_SYMBOLS,
  DOOR_SYMBOLS,
  tilesWithSymbol,
} from '../../world/level/tileGrid'
import { secretShelfOf } from '../../world/library/secretShelf'
import type { ExitId } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/world'
import type { Drawable } from '../depth'
import {
  CELLAR_BULB_SHAPES,
  cellarFloorShapes,
  cellarWallShapes,
  coalHeapShapes,
  looseStoneShapes,
  oddBottleShapes,
} from './cellarArt'
import {
  CHANDELIER_SPRITES,
  type ChandelierState,
  diningFloorShapes,
  diningRugShapes,
  diningWallDecorShapes,
  diningWallShapes,
  frontDoorShapes,
  umbrellaStandShapes,
} from './diningArt'
import {
  type EscapeCoverKind,
  escapeCoverShapes,
  isEscapeCoverKind,
} from './escapeCover'
import {
  kitchenFloorShapes,
  kitchenWallShapes,
  openedExitShapes,
} from './kitchenView'
import {
  SHELF_SHAPES,
  ladderShapes,
  libraryFloorShadeShapes,
  libraryRugShapes,
  libraryWallDecorShapes,
  libraryWallShapes,
} from './libraryArt'
import { allCoverShapes } from './roomCover'
import {
  type Floor,
  PARLOUR_RUG,
  bloodTrail,
  boardShapes,
  cobweb,
  fireGlow,
  parlourFloorOf,
  rugShapes,
  slimePrints,
  slotBoardShapes,
  stallBox,
  stallMatShapes,
} from './roomFloor'
import { type Box, FACE_TOP, boundingBox, boxOfKind } from './roomPalette'
import {
  PARLOUR_WALL_DECOR,
  closedExitShapes,
  doorBox,
  doorwayShapes,
  sconceShapes,
  wallShadowShapes,
  wallShapes,
} from './roomWalls'

// FLOOR DETAILS

const PARLOUR_STAINS: ReadonlyArray<Canvas.Shape> = bloodTrail([
  [214, 21, 2, 5],
  [215, 26, 2, 4],
  [219, 22, 1, 6],
  [220, 28, 2, 3],
  [217, 33, 1, 2],
  [12, 86, 3, 2],
  [15, 89, 2, 1],
  [11, 93, 4, 2],
  [17, 95, 2, 2],
  [52, 118, 3, 2],
  [54, 121, 1, 2],
])

// NOTE: the parlour's own art is placed by hand in the parlour's block, so
// it moves with the parlour wherever the level puts it, and a level with no
// parlour has none.
const inParlour = (
  level: Level,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  pipe(
    level.rooms,
    Array.findFirst(({ id }) => id === PARLOUR_ROOM_ID),
    Option.match({
      onNone: () => [],
      onSome: ({ box }) =>
        box.left === 0 && box.top === 0
          ? shapes
          : [group({ translate: { x: box.left, y: box.top }, shapes })],
    }),
  )

const floorDetailShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...inParlour(level, rugShapes(PARLOUR_RUG)),
  ...Option.match(boxOfKind(level, 'Hearth'), {
    onNone: () => [],
    onSome: fireGlow,
  }),
  ...Option.match(stallBox(level), {
    onNone: () => [],
    onSome: stallMatShapes,
  }),
  ...inParlour(level, PARLOUR_STAINS),
  ...(Array.contains(level.doorIds, 'South')
    ? slimePrints(doorBox(level, 'South'))
    : []),
]

// ROOM BLOCKS

// NOTE: a room's block of the map, where its hand-placed art goes, so the
// art moves with the room wherever the plan puts it.
const roomBoxOf = (level: Level, roomId: string): Option.Option<Box> =>
  pipe(
    level.rooms,
    Array.findFirst(({ id }) => id === roomId),
    Option.map(({ box }) => ({
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    })),
  )

const inRoom = (
  level: Level,
  roomId: string,
  draw: (room: Box) => ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(roomBoxOf(level, roomId), { onNone: () => [], onSome: draw })

const floorOf = (room: Box): Floor => ({
  ...room,
  tileCount: (room.width * room.height) / (TILE_SIZE * TILE_SIZE),
})

// DINING ROOM

const inDining = (
  level: Level,
  draw: (room: Box) => ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> => inRoom(level, DINING_ROOM_ID, draw)

const diningFloorArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  inDining(level, room => [
    ...diningFloorShapes(room),
    ...diningRugShapes(room),
  ])

const diningWallArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  inDining(level, room => [
    ...diningWallShapes(level, room),
    ...diningWallDecorShapes(room),
  ])

const frontDoorArt = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const tiles = tilesWithSymbol(level, DOOR_SYMBOLS.Front)
  return Array.isReadonlyArrayNonEmpty(tiles)
    ? frontDoorShapes(boundingBox(tiles))
    : []
}

// NOTE: the escape rooms' cover kinds and their symbols on the map, drawn by
// escapeCover.ts in their own depth order.
const ESCAPE_COVER_SYMBOLS: Readonly<Record<string, EscapeCoverKind>> =
  Record.filterMap(COVER_SYMBOLS, kind =>
    isEscapeCoverKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const roomCobwebs = (box: Box): ReadonlyArray<Canvas.Shape> => [
  ...cobweb(box.x + TILE_SIZE, box.y + FACE_TOP + 1, true, true),
  ...cobweb(box.x + box.width - TILE_SIZE, box.y + FACE_TOP + 1, false, true),
  ...cobweb(box.x + TILE_SIZE, box.y + box.height - TILE_SIZE, true, false),
  ...cobweb(
    box.x + box.width - TILE_SIZE,
    box.y + box.height - TILE_SIZE,
    false,
    false,
  ),
]

const onFloor = (
  floor: Floor,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  floor.x === 0 && floor.y === 0
    ? shapes
    : [group({ translate: { x: floor.x, y: floor.y }, shapes })]

const cobwebShapes = (level: Floor): ReadonlyArray<Canvas.Shape> =>
  roomCobwebs({ x: 0, y: 0, width: level.width, height: level.height })

// LIBRARY AND CELLAR

// NOTE: the library's floor, the parlour's planks under a dusk of shade,
// and its rug. A room's floor is drawn before the dining room's, so the
// planks' shake margin past the library's west edge is painted over.
const libraryFloorArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  inRoom(level, LIBRARY_ROOM_ID, room => [
    ...onFloor(floorOf(room), slotBoardShapes(floorOf(room))),
    ...libraryFloorShadeShapes(room),
    ...libraryRugShapes(room),
  ])

const cellarFloorArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  inRoom(level, CELLAR_ROOM_ID, room => [
    ...cellarFloorShapes(room),
    ...coalHeapShapes(room),
    ...looseStoneShapes(room),
  ])

const slotWallArt = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...inRoom(level, LIBRARY_ROOM_ID, room => [
    ...libraryWallShapes(level, room),
    ...libraryWallDecorShapes(room),
  ]),
  ...inRoom(level, CELLAR_ROOM_ID, room => cellarWallShapes(level, room)),
]

// NOTE: the bare bulb hangs over the cellar's middle aisle, where the light
// mask lights it (src/render/cellarDark.ts).
export const CELLAR_BULB_OFFSET = { x: 160, y: 52 }

const slotPropArt = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...inRoom(level, LIBRARY_ROOM_ID, ladderShapes),
  ...inRoom(level, CELLAR_ROOM_ID, room => [
    ...oddBottleShapes(room),
    placeAt(
      room.x + CELLAR_BULB_OFFSET.x,
      room.y + CELLAR_BULB_OFFSET.y,
      CELLAR_BULB_SHAPES,
    ),
  ]),
]

const slotCobwebs = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...inRoom(level, LIBRARY_ROOM_ID, roomCobwebs),
  ...inRoom(level, CELLAR_ROOM_ID, room => [
    ...roomCobwebs(room),
    ...cobweb(room.x + 30, room.y + 31, true, true),
    ...cobweb(room.x + 290, room.y + 61, false, true),
  ]),
]

// NOTE: the secret shelf in the library's wall, shut with its red book
// sticking out, or swung open across the floor.
const secretShelfArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Option.match(secretShelfOf(level), {
    onNone: () => [],
    onSome: ({ tile, side }) => [
      placeAt(
        tile.column * TILE_SIZE,
        tile.row * TILE_SIZE,
        SHELF_SHAPES[side][
          Array.contains(level.openExits, SECRET_EXIT) ? 'Open' : 'Shut'
        ],
      ),
    ],
  })

const openedExitArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(
    Array.filter(
      level.exits,
      ({ isOpen, opener }) => isOpen && opener === 'Boards',
    ),
    (exit: Exit) =>
      Array.isReadonlyArrayNonEmpty(exit.tiles)
        ? openedExitShapes(boundingBox(exit.tiles))
        : [],
  )

// ROOM

// NOTE: every shape of the room art for a level, in paint order, as plain
// rectangles. The room images are cut from it.
const roomArtOf = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const floor = parlourFloorOf(level)
  return [
    ...onFloor(
      floor,
      level.rooms.length > 1 ? slotBoardShapes(floor) : boardShapes(floor),
    ),
    ...libraryFloorArt(level),
    ...cellarFloorArt(level),
    ...diningFloorArt(level),
    ...kitchenFloorShapes(level),
    ...floorDetailShapes(level),
    ...wallShadowShapes(level),
    ...wallShapes(level),
    ...diningWallArt(level),
    ...slotWallArt(level),
    ...kitchenWallShapes(level),
    ...inParlour(level, PARLOUR_WALL_DECOR),
    ...sconceShapes(level),
    ...closedExitShapes(level),
    ...openedExitArt(level),
    ...doorwayShapes(level),
    ...secretShelfArt(level),
    ...frontDoorArt(level),
    ...allCoverShapes(level),
    ...escapeCoverShapes(level, ESCAPE_COVER_SYMBOLS),
    ...inDining(level, umbrellaStandShapes),
    ...slotPropArt(level),
    ...onFloor(floor, cobwebShapes(floor)),
    ...inDining(level, roomCobwebs),
    ...slotCobwebs(level),
  ]
}

// NOTE: how far from a room an exit may change the room's art: the boards
// across it, the wall face beside it, its shadow. An exit farther off never
// changes the room's picture.
const EXIT_REACH_PX = TILE_SIZE * 3

const isExitNear =
  (box: ArenaBox) =>
  (exit: Exit): boolean =>
    Array.some(
      exit.tiles,
      ({ column, row }) =>
        (column + 1) * TILE_SIZE > box.left - EXIT_REACH_PX &&
        column * TILE_SIZE < box.right + EXIT_REACH_PX &&
        (row + 1) * TILE_SIZE > box.top - EXIT_REACH_PX &&
        row * TILE_SIZE < box.bottom + EXIT_REACH_PX,
    )

const exitIdsNear = (level: Level, room: Room): ReadonlyArray<ExitId> =>
  Array.map(Array.filter(level.exits, isExitNear(room.box)), ({ id }) => id)

const roomImageCache = new WeakMap<
  LevelSpec,
  Map<string, ReadonlyArray<Canvas.Shape>>
>()

// NOTE: one room's picture with these of its exits open, cut from the whole
// level's art with only those exits open. It is baked once and kept for its
// spec, room, and open exits, so a level whose far exits open or shut gets
// the same image back, and the images a house needs grow with its rooms and
// their own exits, not with every set of open exits in the house.
const roomImage = (
  spec: LevelSpec,
  room: Room,
  openExits: ReadonlyArray<ExitId>,
): ReadonlyArray<Canvas.Shape> => {
  const key = `${room.id}:${Array.join(openExits, '+')}`
  const images =
    roomImageCache.get(spec) ?? new Map<string, ReadonlyArray<Canvas.Shape>>()
  roomImageCache.set(spec, images)
  const cached = images.get(key)
  if (cached !== undefined) {
    return cached
  }
  const image = bakeShapesWithin(roomArtOf(levelFor(spec, openExits)), {
    left: room.box.left,
    top: room.box.top,
    right: room.box.right,
    bottom: room.box.bottom,
  })
  images.set(key, image)
  return image
}

const openExitsNear = (level: Level, room: Room): ReadonlyArray<ExitId> =>
  Array.filter(exitIdsNear(level, room), id =>
    // NOTE: a room has a few exits, read once a level (the room image is cached).
    // oxlint-disable-next-line munch/no-nested-scan
    Array.contains(level.openExits, id),
  )

const builtRooms = new WeakMap<Level, ReadonlyArray<Canvas.Shape>>()

// NOTE: the room is an image for each of the level's rooms, built once for
// each level and kept, so the floor canvas gets the same array back until an
// exit opens and the level changes. The floor canvas paints a room with one
// drawImage. The rooms' blocks do not overlap, so together they paint
// exactly the level's whole picture.
export const roomShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const cached = builtRooms.get(level)
  if (cached !== undefined) {
    return cached
  }
  const shapes = Array.flatMap(level.rooms, room =>
    roomImage(level.spec, room, openExitsNear(level, room)),
  )
  builtRooms.set(level, shapes)
  return shapes
}

const NO_EXITS: ReadonlyArray<ReadonlyArray<ExitId>> = [[]]

// NOTE: only the sets a run can reach: an exit that requires another near
// the room too (the secret shelf and the east boards, both by the dining
// room) is open only with it.
const subsetsOf = (
  level: Level,
  exits: ReadonlyArray<ExitId>,
): ReadonlyArray<ReadonlyArray<ExitId>> =>
  Array.filter(
    // NOTE: every subset of a room's few exits (at most 16), once a level for the atlas.
    // oxlint-disable-next-line munch/no-append-in-reduce
    Array.reduce(exits, NO_EXITS, (subsets, exit) => [
      ...subsets,
      ...Array.map(subsets, subset => Array.append(subset, exit)),
    ]),
    subset =>
      Array.every(subset, id =>
        Option.exists(maybeExit(level, id), ({ requires }) =>
          // NOTE: every subset of a room's few exits (at most 16), once a level for the atlas.
          // oxlint-disable-next-line munch/no-nested-scan
          Array.every(
            requires,
            required =>
              // NOTE: every subset of a room's few exits (at most 16), once a level for the atlas.
              // oxlint-disable-next-line munch/no-nested-scan
              !Array.contains(exits, required) ||
              Array.contains(subset, required),
          ),
        ),
      ),
  )

// NOTE: every room image a level spec can show: each room with each set of
// its own nearby exits open, for the sprite atlas.
export const everyRoomImage = (
  spec: LevelSpec,
): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(spec)
  return Array.flatMap(level.rooms, room =>
    Array.flatMap(subsetsOf(level, exitIdsNear(level, room)), openExits =>
      roomImage(spec, room, openExits),
    ),
  )
}

// HEARTH FIRE

const FIRE_FRAME_MS = 130

const FIRE_PALETTE: Palette = {
  Y: '#ffe066',
  O: '#ff9a2a',
  R: '#e0482a',
  D: '#a02818',
}

const FIRE_FRAMES: Array.NonEmptyReadonlyArray<ReadonlyArray<string>> = [
  [
    '.......Y..........',
    '......YO.....Y....',
    '...Y..YO....YO....',
    '...OY.OOY..YOO..Y.',
    '..YOO.OROY.OOR.YO.',
    '..OROYORRO.ORRYOR.',
    '.YORRORRRROORRORRY',
    '.ORRRRRDRRRRRDRRRO',
    'ORRDRRDDDRRDRDDRRO',
    'RRDDDDDDDDDDDDDDRR',
    '.DDDDDDDDDDDDDDDD.',
  ],
  [
    '...........Y......',
    '...Y.......OY.....',
    '...OY..Y...OO..Y..',
    '..YOO..OY.YOR.YO..',
    '..ORO.YOO.ORR.OR..',
    '.YORRYORRYORROORY.',
    '.ORRRORRRRRRRRRRRO',
    'YRRDRRRDRRRDRRDRRO',
    'ORDDDRDDDRDDDRDDRR',
    'RRDDDDDDDDDDDDDDRR',
    '.DDDDDDDDDDDDDDDD.',
  ],
  [
    '.....Y.......Y....',
    '....YO......YO....',
    '....OO..Y...OR.Y..',
    '.Y.YOR..OY.YRR.OY.',
    '.OYORR.YOO.ORR.RO.',
    'YORRRRYORROORRYRRY',
    'ORRRDRRRRRRRRDRRRO',
    'ORRDDRRDRRRDDDRRRO',
    'RRDDDDDDDDRDDDDDRR',
    'RRDDDDDDDDDDDDDDRR',
    '.DDDDDDDDDDDDDDDD.',
  ],
]

const FIRE_SPRITES: Array.NonEmptyReadonlyArray<Sprite> = Array.map(
  FIRE_FRAMES,
  pixels => spriteShapes(pixels, FIRE_PALETTE, TOP_LEFT),
)

const FIRE_WIDTH = 18

type Spot = Readonly<{ x: number; y: number }>

const fireSpots = new WeakMap<Level, Option.Option<Spot>>()

const fireSpotOf = (level: Level): Option.Option<Spot> => {
  const cached = fireSpots.get(level)
  if (cached !== undefined) {
    return cached
  }
  const spot = Option.map(boxOfKind(level, 'Hearth'), ({ x, y, width }) => ({
    x: x + Math.floor((width - FIRE_WIDTH) / 2),
    y: y - 6,
  }))
  fireSpots.set(level, spot)
  return spot
}

export const hearthFireShapes: {
  (elapsedMs: number): (level: Level) => ReadonlyArray<Canvas.Shape>
  (level: Level, elapsedMs: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (level: Level, elapsedMs: number): ReadonlyArray<Canvas.Shape> =>
    Option.match(fireSpotOf(level), {
      onNone: () => [],
      onSome: ({ x, y }) => [
        placeAt(
          x,
          y,
          Option.getOrElse(
            Array.get(
              FIRE_SPRITES,
              Math.floor(elapsedMs / FIRE_FRAME_MS) % FIRE_SPRITES.length,
            ),
            () => FIRE_SPRITES[0],
          ),
        ),
      ],
    }),
)

// THE CHANDELIER

const chandelierAt = (
  level: Level,
  state: ChandelierState,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(gapBoxOf(level), {
    onNone: () => [],
    onSome: gap => [
      placeAt(
        (gap.left + gap.right) / 2,
        state === 'Fallen' ? (gap.top + gap.bottom) / 2 : gap.top,
        CHANDELIER_SPRITES[state],
      ),
    ],
  })

// NOTE: the dining room's chandelier hangs over the table's gap, over
// everyone who walks under it, so the scene draws it last.
export const hungChandelierShapes = (
  world: World,
): ReadonlyArray<Canvas.Shape> =>
  isChandelierDown(world) ? [] : chandelierAt(levelOf(world), 'Hung')

// NOTE: fallen, it lies in the gap as cover, in the depth sort at the gap's
// foot.
export const fallenChandelierDrawables = (
  world: World,
): ReadonlyArray<Drawable> =>
  isChandelierDown(world)
    ? Option.match(gapBoxOf(levelOf(world)), {
        onNone: () => [],
        onSome: gap => [
          {
            footY: gap.bottom,
            rank: 'Prop',
            shapes: chandelierAt(levelOf(world), 'Fallen'),
          },
        ],
      })
    : []
