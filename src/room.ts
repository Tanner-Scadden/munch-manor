import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import {
  type Exit,
  type Level,
  MANOR,
  MANOR_SPEC,
  PARLOUR_SPEC,
  openExit,
} from './arena'
import { TILE_SIZE } from './constants'
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
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  placeAt,
  spriteShapes,
} from './sprite'

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

const isParlour = (level: Level): boolean =>
  level.spec.id === PARLOUR_SPEC.id || level.spec.id === MANOR_SPEC.id

const floorDetailShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...(isParlour(level) ? rugShapes(PARLOUR_RUG) : []),
  ...Option.match(boxOfKind(level, 'Hearth'), {
    onNone: () => [],
    onSome: fireGlow,
  }),
  ...Option.match(stallBox(level), {
    onNone: () => [],
    onSome: stallMatShapes,
  }),
  ...(isParlour(level) ? PARLOUR_STAINS : []),
  ...(isParlour(level) && Array.contains(level.doorIds, 'South')
    ? slimePrints(doorBox(level, 'South'))
    : []),
]

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

const builtRooms = new WeakMap<Level, ReadonlyArray<Canvas.Shape>>()

// NOTE: the room is built once for each level and kept, so the floor canvas
// gets the same array back until an exit opens and the level changes. It is
// baked into one image, so the floor canvas paints it with one drawImage.
export const roomShapes = (level: Level): ReadonlyArray<Canvas.Shape> => {
  const cached = builtRooms.get(level)
  if (cached !== undefined) {
    return cached
  }
  const floor = parlourFloorOf(level)
  const shapes = bakeShapes([
    ...boardShapes(floor),
    ...kitchenFloorShapes(level),
    ...floorDetailShapes(level),
    ...wallShadowShapes(level),
    ...wallShapes(level),
    ...kitchenWallShapes(level),
    ...(isParlour(level) ? PARLOUR_WALL_DECOR : []),
    ...sconceShapes(level),
    ...closedExitShapes(level),
    ...openedExitArt(level),
    ...doorwayShapes(level),
    ...allCoverShapes(level),
    ...cobwebShapes(floor),
  ])
  builtRooms.set(level, shapes)
  return shapes
}

// NOTE: the manor's two room images, with the kitchen shut and open. The
// sprite warm-up asks for both before it lists the images to decode, so the
// open kitchen's image is decoded behind the loading splash and opening the
// kitchen never shows a bare floor for a frame.
export const manorRoomImages = (): ReadonlyArray<Canvas.Shape> => [
  ...roomShapes(MANOR),
  ...roomShapes(openExit(MANOR, 'Kitchen')),
]

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

export const hearthFireShapes = (
  level: Level,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
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
  })
