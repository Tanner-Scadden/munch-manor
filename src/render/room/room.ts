import { Array, Function, Option, pipe } from 'effect'
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
import {
  type Box as ArenaBox,
  type Exit,
  type Level,
  type Room,
  levelFor,
} from '../../world/level/arena'
import {
  type LevelSpec,
  MANOR_SPEC,
  PARLOUR_ROOM_ID,
} from '../../world/level/plan'
import type { ExitId } from '../../world/schema/entitySchema'
import {
  kitchenFloorShapes,
  kitchenWallShapes,
  openedExitShapes,
} from './kitchenView'
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
  stallBox,
  stallMatShapes,
} from './roomFloor'
import { FACE_TOP, boundingBox, boxOfKind } from './roomPalette'
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

const isParlour = (level: Level): boolean =>
  Array.some(level.rooms, ({ id }) => id === PARLOUR_ROOM_ID)

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
  ...(isParlour(level) && Array.contains(level.doorIds, 'South')
    ? slimePrints(doorBox(level, 'South'))
    : []),
]

const onFloor = (
  floor: Floor,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  floor.x === 0 && floor.y === 0
    ? shapes
    : [group({ translate: { x: floor.x, y: floor.y }, shapes })]

const cobwebShapes = (level: Floor): ReadonlyArray<Canvas.Shape> => [
  ...cobweb(TILE_SIZE, FACE_TOP + 1, true, true),
  ...cobweb(level.width - TILE_SIZE, FACE_TOP + 1, false, true),
  ...cobweb(TILE_SIZE, level.height - TILE_SIZE, true, false),
  ...cobweb(level.width - TILE_SIZE, level.height - TILE_SIZE, false, false),
]

const openedExitArt = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(
    Array.filter(level.exits, ({ isOpen }) => isOpen),
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
    ...onFloor(floor, boardShapes(floor)),
    ...kitchenFloorShapes(level),
    ...floorDetailShapes(level),
    ...wallShadowShapes(level),
    ...wallShapes(level),
    ...kitchenWallShapes(level),
    ...inParlour(level, PARLOUR_WALL_DECOR),
    ...sconceShapes(level),
    ...closedExitShapes(level),
    ...openedExitArt(level),
    ...doorwayShapes(level),
    ...allCoverShapes(level),
    ...onFloor(floor, cobwebShapes(floor)),
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

const subsetsOf = (
  exits: ReadonlyArray<ExitId>,
): ReadonlyArray<ReadonlyArray<ExitId>> =>
  Array.reduce(exits, NO_EXITS, (subsets, exit) => [
    ...subsets,
    ...Array.map(subsets, subset => Array.append(subset, exit)),
  ])

// NOTE: every room image a level spec can show: each room with each set of
// its own nearby exits open, for the sprite atlas.
export const everyRoomImage = (
  spec: LevelSpec,
): ReadonlyArray<Canvas.Shape> => {
  const level = levelFor(spec)
  return Array.flatMap(level.rooms, room =>
    Array.flatMap(subsetsOf(exitIdsNear(level, room)), openExits =>
      roomImage(spec, room, openExits),
    ),
  )
}

// NOTE: the manor's room images, with the kitchen shut and open. The sprite
// warm-up asks for them before it lists the images to decode, so the open
// kitchen's images are decoded behind the loading splash and opening the
// kitchen never shows a bare floor for a frame.
export const manorRoomImages = (): ReadonlyArray<Canvas.Shape> =>
  everyRoomImage(MANOR_SPEC)

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
