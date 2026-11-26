import { Array, Function, Option, Record, Result, pipe } from 'effect'

import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapesWithin,
  deepSprite,
  glowingSprite,
  group,
  placeAt,
  spriteShapes,
} from '#art/sprite.ts'
import { type Drawable, ON_FRONT_PX } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { gapBoxOf, isChandelierDown } from '#world/dining/chandelier.ts'
import {
  type Exit,
  type Level,
  type Room,
  levelFor,
  levelOf,
  maybeExit,
} from '#world/level/arena.ts'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  LIBRARY_ROOM_ID,
  type LevelSpec,
  PARLOUR_ROOM_ID,
  SECRET_EXIT,
} from '#world/level/plan.ts'
import { PARLOUR_RUG } from '#world/level/rugs.ts'
import {
  type Box as ArenaBox,
  COVER_SYMBOLS,
  DOOR_SYMBOLS,
  tilesWithSymbol,
} from '#world/level/tileGrid.ts'
import { secretShelfOf } from '#world/library/secretShelf.ts'
import type { ExitId } from '#world/schema/entitySchema.ts'
import type { World } from '#world/schema/world.ts'

import {
  CELLAR_BULB_SHAPES,
  cellarFloorShapes,
  cellarWallShapes,
  coalHeapShapes,
  heartJarShapes,
  looseStoneShapes,
  oddBottleShapes,
} from './cellarArt.ts'
import {
  CHANDELIER_SPRITES,
  type ChandelierState,
  diningFloorShapes,
  diningRugShapes,
  diningWallDecorShapes,
  diningWallShapes,
  frontDoorShapes,
  umbrellaStandShapes,
} from './diningArt.ts'
import {
  type EscapeCoverKind,
  escapeCoverShapes,
  isEscapeCoverKind,
} from './escapeCover.ts'
import {
  kitchenFloorShapes,
  kitchenWallShapes,
  openedExitShapes,
} from './kitchenView.ts'
import {
  SHELF_SHAPES,
  ladderShapes,
  libraryFloorShadeShapes,
  libraryRugShapes,
  libraryWallDecorShapes,
  libraryWallShapes,
} from './libraryArt.ts'
import { allCoverShapes } from './roomCover.ts'
import {
  type Floor,
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
} from './roomFloor.ts'
import { type Box, FACE_TOP, boundingBox, boxOfKind } from './roomPalette.ts'
import {
  PARLOUR_WALL_DECOR,
  closedExitShapes,
  doorBox,
  doorwayShapes,
  wallShadowShapes,
  wallShapes,
} from './roomWalls.ts'
import { roseWindowShapes } from './roseWindowArt.ts'

const PARLOUR_STAINS: ReadonlyArray<Draw.Shape> = bloodTrail([
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

const inParlour = (
  level: Level,
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
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

const floorDetailShapes = (level: Level): ReadonlyArray<Draw.Shape> => [
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

export const isRoomOpen: {
  (roomId: string): (level: Level) => boolean
  (level: Level, roomId: string): boolean
} = Function.dual(2, (level: Level, roomId: string): boolean =>
  Array.some(level.rooms, ({ id, isOpen }) => id === roomId && isOpen),
)

export const roomBoxOf: {
  (roomId: string): (level: Level) => Option.Option<Box>
  (level: Level, roomId: string): Option.Option<Box>
} = Function.dual(2, (level: Level, roomId: string): Option.Option<Box> =>
  pipe(
    level.rooms,
    Array.findFirst(({ id }) => id === roomId),
    Option.map(({ box }) => ({
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    })),
  ),
)

const inRoom = (
  level: Level,
  roomId: string,
  draw: (room: Box) => ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
  Option.match(roomBoxOf(level, roomId), { onNone: () => [], onSome: draw })

const floorOf = (room: Box): Floor => ({
  ...room,
  tileCount: (room.width * room.height) / (TILE_SIZE * TILE_SIZE),
})

const inDining = (
  level: Level,
  draw: (room: Box) => ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> => inRoom(level, DINING_ROOM_ID, draw)

const diningFloorArt = (level: Level): ReadonlyArray<Draw.Shape> =>
  inDining(level, room => [
    ...diningFloorShapes(room),
    ...diningRugShapes(room),
  ])

const diningWallArt = (level: Level): ReadonlyArray<Draw.Shape> =>
  inDining(level, room => [
    ...diningWallShapes(level, room),
    ...diningWallDecorShapes(room),
  ])

const frontDoorArt = (level: Level): ReadonlyArray<Draw.Shape> => {
  const tiles = tilesWithSymbol(level, DOOR_SYMBOLS.Front)
  return Array.isReadonlyArrayNonEmpty(tiles)
    ? frontDoorShapes(boundingBox(tiles))
    : []
}

const ESCAPE_COVER_SYMBOLS: Readonly<Record<string, EscapeCoverKind>> =
  Record.filterMap(COVER_SYMBOLS, kind =>
    isEscapeCoverKind(kind) ? Result.succeed(kind) : Result.failVoid,
  )

const roomCobwebs = (box: Box): ReadonlyArray<Draw.Shape> => [
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
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
  floor.x === 0 && floor.y === 0
    ? shapes
    : [group({ translate: { x: floor.x, y: floor.y }, shapes })]

const cobwebShapes = (level: Floor): ReadonlyArray<Draw.Shape> =>
  roomCobwebs({ x: 0, y: 0, width: level.width, height: level.height })

const libraryFloorArt = (level: Level): ReadonlyArray<Draw.Shape> =>
  inRoom(level, LIBRARY_ROOM_ID, room => [
    ...onFloor(floorOf(room), slotBoardShapes(floorOf(room))),
    ...libraryFloorShadeShapes(room),
    ...libraryRugShapes(room),
  ])

const cellarFloorArt = (level: Level): ReadonlyArray<Draw.Shape> =>
  inRoom(level, CELLAR_ROOM_ID, room => [
    ...cellarFloorShapes(room),
    ...coalHeapShapes(room),
    ...looseStoneShapes(room),
  ])

const slotWallArt = (level: Level): ReadonlyArray<Draw.Shape> => [
  ...inRoom(level, LIBRARY_ROOM_ID, room => [
    ...libraryWallShapes(level, room),
    ...libraryWallDecorShapes(room),
    ...roseWindowShapes(room),
  ]),
  ...inRoom(level, CELLAR_ROOM_ID, room => [
    ...cellarWallShapes(level, room),
    ...heartJarShapes(room),
  ]),
]

const CELLAR_BULB_OFFSET = { x: 160, y: 52 }

const slotPropArt = (level: Level): ReadonlyArray<Draw.Shape> => [
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

const slotCobwebs = (level: Level): ReadonlyArray<Draw.Shape> => [
  ...inRoom(level, LIBRARY_ROOM_ID, roomCobwebs),
  ...inRoom(level, CELLAR_ROOM_ID, room => [
    ...roomCobwebs(room),
    ...cobweb(room.x + 30, room.y + 31, true, true),
    ...cobweb(room.x + 290, room.y + 61, false, true),
  ]),
]

const secretShelfArt = (level: Level): ReadonlyArray<Draw.Shape> =>
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

const openedExitArt = (level: Level): ReadonlyArray<Draw.Shape> =>
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

export const roomArtOf = (level: Level): ReadonlyArray<Draw.Shape> => {
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

interface ShapesByPath {
  maybeShapes: Option.Option<ReadonlyArray<Draw.Shape>>
  readonly next: Map<string, ShapesByPath>
}

const emptyPath = (): ShapesByPath => ({
  maybeShapes: Option.none(),
  next: new Map(),
})

const shapesAt = (
  root: ShapesByPath,
  path: ReadonlyArray<string>,
  make: () => ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> => {
  let node = root
  for (const step of path) {
    const known = node.next.get(step)
    const child = known ?? emptyPath()
    if (known === undefined) {
      node.next.set(step, child)
    }
    node = child
  }
  return Option.getOrElse(node.maybeShapes, () => {
    const shapes = make()
    node.maybeShapes = Option.some(shapes)
    return shapes
  })
}

const rootFor = (
  cache: WeakMap<LevelSpec, ShapesByPath>,
  spec: LevelSpec,
): ShapesByPath => {
  const known = cache.get(spec)
  const root = known ?? emptyPath()
  if (known === undefined) {
    cache.set(spec, root)
  }
  return root
}

const levelArtCache = new WeakMap<LevelSpec, ShapesByPath>()

const levelArtOf = (
  spec: LevelSpec,
  openExits: ReadonlyArray<ExitId>,
): ReadonlyArray<Draw.Shape> =>
  shapesAt(rootFor(levelArtCache, spec), openExits, () =>
    roomArtOf(levelFor(spec, openExits)),
  )

const roomImageCache = new WeakMap<LevelSpec, ShapesByPath>()

const roomImage = (
  spec: LevelSpec,
  room: Room,
  openExits: ReadonlyArray<ExitId>,
): ReadonlyArray<Draw.Shape> =>
  shapesAt(rootFor(roomImageCache, spec), [room.id, ...openExits], () =>
    bakeShapesWithin(levelArtOf(spec, openExits), {
      left: room.box.left,
      top: room.box.top,
      right: room.box.right,
      bottom: room.box.bottom,
    }),
  )

const openExitsNear = (level: Level, room: Room): ReadonlyArray<ExitId> => {
  const open: ReadonlySet<ExitId> = new Set(level.openExits)
  return Array.filter(exitIdsNear(level, room), id => open.has(id))
}

const builtRooms = new WeakMap<Level, ReadonlyArray<Draw.Shape>>()

export const roomShapes = (level: Level): ReadonlyArray<Draw.Shape> => {
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

const subsetsOf = (
  level: Level,
  exits: ReadonlyArray<ExitId>,
): ReadonlyArray<ReadonlyArray<ExitId>> => {
  const bitOf = new Map<ExitId, number>()
  Array.forEach(exits, (id, index) => {
    bitOf.set(id, 1 << index)
  })
  const needs = Array.map(exits, id =>
    Option.map(maybeExit(level, id), ({ requires }) =>
      Array.reduce(
        requires,
        0,
        (need, required) => need | (bitOf.get(required) ?? 0),
      ),
    ),
  )
  const subsets: Array<ReadonlyArray<ExitId>> = []
  for (let mask = 0; mask < 1 << exits.length; mask++) {
    const isOpenable = Array.every(
      needs,
      (need, index) =>
        (mask & (1 << index)) === 0 ||
        Option.exists(need, bits => (mask & bits) === bits),
    )
    if (isOpenable) {
      subsets.push(
        Array.filter(exits, (_, index) => (mask & (1 << index)) !== 0),
      )
    }
  }
  return subsets
}

export const everyRoomImage = (spec: LevelSpec): ReadonlyArray<Draw.Shape> => {
  const level = levelFor(spec)
  return Array.flatMap(level.rooms, room =>
    Array.flatMap(subsetsOf(level, exitIdsNear(level, room)), openExits =>
      roomImage(spec, room, openExits),
    ),
  )
}

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
  pixels =>
    glowingSprite(
      deepSprite(spriteShapes(pixels, FIRE_PALETTE, TOP_LEFT), {
        most: 1,
        isUpright: true,
      }),
    ),
)

export const FIRE_WIDTH = 18

type Spot = Readonly<{ x: number; y: number }>

export type FireSpot = Spot & Readonly<{ footY: number }>

const fireSpots = new WeakMap<Level, Option.Option<FireSpot>>()

export const fireSpotOf = (level: Level): Option.Option<FireSpot> => {
  const cached = fireSpots.get(level)
  if (cached !== undefined) {
    return cached
  }
  const spot = Option.map(
    boxOfKind(level, 'Hearth'),
    ({ x, y, width, height }) => ({
      x: x + Math.floor((width - FIRE_WIDTH) / 2),
      y: y - 6,
      footY: y + height + ON_FRONT_PX,
    }),
  )
  fireSpots.set(level, spot)
  return spot
}

export const hearthFireDrawables: {
  (elapsedMs: number): (level: Level) => ReadonlyArray<Drawable>
  (level: Level, elapsedMs: number): ReadonlyArray<Drawable>
} = Function.dual(
  2,
  (level: Level, elapsedMs: number): ReadonlyArray<Drawable> =>
    Option.match(fireSpotOf(level), {
      onNone: () => [],
      onSome: ({ x, y, footY }) => [
        {
          footY,
          rank: 'Prop',
          shapes: [
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
        },
      ],
    }),
)

const chandelierAt = (
  level: Level,
  state: ChandelierState,
): ReadonlyArray<Draw.Shape> =>
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

export const hungChandelierShapes = (
  world: World,
): ReadonlyArray<Draw.Shape> =>
  isChandelierDown(world) ? [] : chandelierAt(levelOf(world), 'Hung')

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
