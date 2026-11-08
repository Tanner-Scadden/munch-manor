import { Array, Option, Result, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { type Model, Oven } from '../../app/model'
import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { pixelArt, rect } from '../../render/drawing'
import { TILE_SIZE } from '../../shared/constants'
import { nextRandom } from '../../shared/prng'
import {
  OVEN_RULES,
  flameBoxOf,
  ovenBoxesOf,
  ovensOf,
} from '../../world/kitchen/kitchen'
import {
  type Level,
  SOUP_SYMBOL,
  type Tile,
  levelOf,
  symbolAt,
  tilesWithSymbol,
} from '../../world/level/arena'
import { maybePadlockedExit } from '../../world/level/exits'

// NOTE: the kitchen is drawn like the parlour: everything that never moves
// is part of the room's one baked image, and only the ovens' glow and their
// flames are drawn each frame. A few rectangles a frame for two ovens, and a
// flame image while one belches.

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const KITCHEN_SEED = 0x6b17c3e5

const roll = (first: number, second: number): number =>
  nextRandom(KITCHEN_SEED ^ Math.imul(first, 0x9e3779b1) ^ (second * 7919))
    .value

// PALETTE

const TILE_LIGHT_COLOR = '#5e5a4e'
const TILE_DARK_COLOR = '#37353c'
const TILE_CRACK_COLOR = '#2a2830'
const GRIME_COLOR = 'rgba(40, 30, 20, 0.28)'
const BACKSPLASH_COLOR = '#7e8a7a'
const BACKSPLASH_GROUT_COLOR = '#55604f'
const BACKSPLASH_GRIME_COLOR = 'rgba(60, 50, 20, 0.35)'
const RAIL_COLOR = '#3a2a1c'
const IRON_COLOR = '#2a2a30'
const IRON_LIGHT_COLOR = '#44444c'
const IRON_DARK_COLOR = '#16161b'
const IRON_EDGE_COLOR = '#5a5a66'
const COPPER_COLOR = '#b0683a'
const COPPER_LIGHT_COLOR = '#d8925a'
const WOOD_COLOR = '#8a6a44'
const WOOD_LIGHT_COLOR = '#a8865a'
const WOOD_DARK_COLOR = '#5c4428'
const CABINET_COLOR = '#4a3020'
const CABINET_DARK_COLOR = '#2e1d12'
const PORCELAIN_COLOR = '#d8d4c8'
const PORCELAIN_SHADE_COLOR = '#a8a498'
const BONE_COLOR = '#e8e2cc'
const INK_COLOR = '#141018'
const SKIN_COLOR = '#8fc060'
const BLOOD_COLOR = 'rgba(120, 18, 28, 0.55)'
const SOUP_COLOR = '#7c9c3a'
const SOUP_LIGHT_COLOR = '#a6c450'
const SOUP_RIM_COLOR = '#4e6624'
const CARROT_COLOR = '#e07a2a'
const PEA_COLOR = '#c6e070'
const BURLAP_COLOR = '#9a8456'
const BURLAP_DARK_COLOR = '#6e5c38'
const FLOUR_COLOR = '#e8e2d4'
const YARD_COLOR = '#0f1813'
const YARD_GRASS_COLOR = '#18241a'
const DOOR_DARK_COLOR = '#0c090d'
const CASING_COLOR = '#6b4a2e'
const CASING_LIGHT_COLOR = '#8a6440'
const CASING_DARK_COLOR = '#3a2616'
const PLANK_COLOR = '#8a6a44'
const PLANK_DARK_COLOR = '#5c4428'
const GLASS_COLOR = '#9ab8c8'
const NIGHT_COLOR = '#1c2a44'
const CURTAIN_COLOR = '#6a2a3a'
const SIGN_COLOR = '#e8c040'
const SIGN_DARK_COLOR = '#8a6a1a'
const COBWEB_COLOR = 'rgba(220, 220, 235, 0.45)'

// FLOOR

const kitchenBox = (level: Level): Option.Option<Box> =>
  pipe(
    level.rooms,
    Array.findFirst(({ id }) => id === 'Kitchen'),
    Option.map(({ box }) => ({
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    })),
  )

const CHECKER_PX = 5

// NOTE: the floor under the kitchen's walls is drawn too and the walls cover
// it, so the floor is only the light checks laid on a dark fill.
const checkerShapes = (box: Box): ReadonlyArray<Canvas.Shape> => {
  const columns = Math.floor(box.width / CHECKER_PX)
  const rows = Math.floor(box.height / CHECKER_PX)
  return [
    rect(box.x, box.y, box.width, box.height, TILE_DARK_COLOR),
    ...Array.flatMap(
      Array.makeBy(rows, row => row),
      row =>
        Array.filterMap(
          Array.makeBy(columns, column => column),
          column =>
            (row + column) % 2 === 0
              ? Result.succeed(
                  rect(
                    box.x + column * CHECKER_PX,
                    box.y + row * CHECKER_PX,
                    CHECKER_PX,
                    CHECKER_PX,
                    TILE_LIGHT_COLOR,
                  ),
                )
              : Result.failVoid,
        ),
    ),
    ...Array.makeBy(26, index =>
      rect(
        box.x + Math.floor(roll(index, 1) * box.width),
        box.y + Math.floor(roll(index, 2) * box.height),
        2 + Math.floor(roll(index, 3) * 5),
        1 + Math.floor(roll(index, 4) * 3),
        GRIME_COLOR,
      ),
    ),
    ...Array.makeBy(8, index => {
      const x = box.x + Math.floor(roll(index, 5) * box.width)
      const y = box.y + Math.floor(roll(index, 6) * box.height)
      return rect(x, y, 3, 1, TILE_CRACK_COLOR)
    }),
  ]
}

// NOTE: the yard is outside the house, in the dark. Zombies cross it on the
// way to the parlour's north door, and nothing out here is drawn but grass
// and a path.
const GRAVESTONE_PIXELS: ReadonlyArray<string> = [
  '..sss..',
  '.sSSSs.',
  'sSSkSSs',
  'sSkkkSs',
  'sSSkSSs',
  'sSSSSSs',
  'sSSSSSd',
  'ddddddd',
]

const CROSS_PIXELS: ReadonlyArray<string> = [
  '..s..',
  '..S..',
  'sSSSs',
  '..S..',
  '..S..',
  '..S..',
  '.ddd.',
]

const BUSH_PIXELS: ReadonlyArray<string> = [
  'b...b..b.',
  '.b.b..b..',
  '..bbbbb.b',
  '.b.bbb.b.',
  'b..bbb...',
  '...ddd...',
]

const YARD_PALETTE: Palette = {
  s: '#5a6070',
  S: '#3c414c',
  k: '#22252c',
  d: '#0a0e0b',
  b: '#2a2018',
}

const FENCE_COLOR = '#16141a'
const FENCE_TIP_COLOR = '#2c2a34'
const MOON_COLOR = 'rgba(160, 190, 220, 0.035)'
const STEP_COLOR = '#2a2a30'

// NOTE: the yard is the manor's garden edge at night, outside the house:
// moonlit grass, an iron fence along the top, gravestones, dead bushes, and
// stepping stones to the parlour's north door. Zombies cross it on the way
// to that door, and no actor out here is drawn.
const yardShapes = (box: Box): ReadonlyArray<Canvas.Shape> => {
  const right = box.x + box.width
  const fenceY = box.y + 6
  const doorX = box.x + 12
  return [
    rect(box.x, box.y, box.width, box.height, YARD_COLOR),
    ...Array.makeBy(16, index => {
      const width = 16 + Math.floor(roll(index, 31) * 40)
      const height = 10 + Math.floor(roll(index, 32) * 26)
      return rect(
        box.x + 20 + Math.floor(roll(index, 33) * (box.width - 30 - width)),
        box.y + 16 + Math.floor(roll(index, 34) * (box.height - 30 - height)),
        width,
        height,
        MOON_COLOR,
      )
    }),
    ...Array.makeBy(70, index =>
      rect(
        box.x + Math.floor(roll(index, 11) * box.width),
        box.y + 10 + Math.floor(roll(index, 12) * (box.height - 10)),
        1,
        1 + Math.floor(roll(index, 13) * 2),
        index % 3 === 0 ? '#22301f' : YARD_GRASS_COLOR,
      ),
    ),
    ...Array.makeBy(8, index =>
      rect(
        doorX + 3 + (index % 2) * 7,
        box.y + 18 + index * 16,
        7,
        5,
        STEP_COLOR,
      ),
    ),
    rect(box.x, fenceY, box.width, 1, FENCE_COLOR),
    rect(box.x, fenceY + 6, box.width, 1, FENCE_COLOR),
    ...Array.flatMap(
      Array.makeBy(Math.floor(box.width / 4), index => index),
      index => [
        rect(box.x + 1 + index * 4, fenceY - 3, 1, 12, FENCE_COLOR),
        rect(box.x + 1 + index * 4, fenceY - 4, 1, 1, FENCE_TIP_COLOR),
      ],
    ),
    rect(right - 2, fenceY, 1, box.height - fenceY + box.y, FENCE_COLOR),
    ...pixelArt(box.x + 48, box.y + 36, GRAVESTONE_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 78, box.y + 30, CROSS_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 96, box.y + 52, GRAVESTONE_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 62, box.y + 82, CROSS_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 88, box.y + 104, GRAVESTONE_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 40, box.y + 120, GRAVESTONE_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 102, box.y + 16, BUSH_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 34, box.y + 64, BUSH_PIXELS, YARD_PALETTE),
    ...pixelArt(box.x + 104, box.y + 128, BUSH_PIXELS, YARD_PALETTE),
  ]
}

const isSoup = (level: Level, column: number, row: number): boolean =>
  Option.contains(symbolAt(level, column, row), SOUP_SYMBOL)

// NOTE: spilled soup is a pea green puddle with a darker rim where it meets
// dry floor, carrots and peas floating in it, and a few drips around it.
const soupTileShapes =
  (level: Level) =>
  ({ column, row }: Tile): ReadonlyArray<Canvas.Shape> => {
    const x = column * TILE_SIZE
    const y = row * TILE_SIZE
    const isUpDry = !isSoup(level, column, row - 1)
    const isDownDry = !isSoup(level, column, row + 1)
    const isLeftDry = !isSoup(level, column - 1, row)
    const isRightDry = !isSoup(level, column + 1, row)
    const inset = (isDry: boolean): number => (isDry ? 1 : 0)
    const left = x + inset(isLeftDry)
    const top = y + inset(isUpDry)
    const right = x + TILE_SIZE - inset(isRightDry)
    const bottom = y + TILE_SIZE - inset(isDownDry)
    return [
      rect(left, top, right - left, bottom - top, SOUP_COLOR),
      ...(isUpDry
        ? [rect(left + 1, top, right - left - 2, 1, SOUP_RIM_COLOR)]
        : []),
      ...(isDownDry
        ? [rect(left + 1, bottom - 1, right - left - 2, 1, SOUP_RIM_COLOR)]
        : []),
      ...(isLeftDry
        ? [rect(left, top + 1, 1, bottom - top - 2, SOUP_RIM_COLOR)]
        : []),
      ...(isRightDry
        ? [rect(right - 1, top + 1, 1, bottom - top - 2, SOUP_RIM_COLOR)]
        : []),
      rect(x + 3, y + 3, 2, 1, SOUP_LIGHT_COLOR),
      rect(
        x + 2 + Math.floor(roll(column, row) * 5),
        y + 5 + Math.floor(roll(row, column) * 3),
        2,
        1,
        roll(column + 7, row) < 0.5 ? CARROT_COLOR : PEA_COLOR,
      ),
      rect(
        x + 6,
        y + 2 + Math.floor(roll(column, row + 3) * 5),
        1,
        1,
        PEA_COLOR,
      ),
    ]
  }

const WET_FLOOR_SIGN: ReadonlyArray<string> = [
  '..dd..',
  '.dyyd.',
  '.dykd.',
  'dyyyyd',
  'dykkyd',
  'dyyyyd',
  'd....d',
]

const wetFloorSign = (x: number, y: number): ReadonlyArray<Canvas.Shape> =>
  pixelArt(x, y, WET_FLOOR_SIGN, {
    d: SIGN_DARK_COLOR,
    y: SIGN_COLOR,
    k: INK_COLOR,
  })

const soupShapes = (level: Level): ReadonlyArray<Canvas.Shape> => [
  ...Array.flatMap(tilesWithSymbol(level, SOUP_SYMBOL), soupTileShapes(level)),
  ...wetFloorSign(172, -60),
]

export const kitchenFloorShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Option.match(kitchenBox(level), {
    onNone: () => [],
    onSome: box => {
      const yardLeft = 20 * TILE_SIZE
      return [
        ...checkerShapes({ ...box, width: yardLeft - box.x }),
        ...yardShapes({
          ...box,
          x: yardLeft,
          width: box.x + box.width - yardLeft,
        }),
        ...soupShapes(level),
      ]
    },
  })

// WALL DECOR

const FACE_TOP = 3
const FACE_HEIGHT = TILE_SIZE * 2 - FACE_TOP

type Span = Readonly<{ left: number; right: number }>

const backsplash = (
  top: number,
  { left, right }: Span,
): ReadonlyArray<Canvas.Shape> => [
  rect(left, top, right - left, FACE_HEIGHT, BACKSPLASH_COLOR),
  ...Array.makeBy(Math.floor(FACE_HEIGHT / 4), index =>
    rect(left, top + 2 + index * 4, right - left, 1, BACKSPLASH_GROUT_COLOR),
  ),
  ...Array.makeBy(Math.floor((right - left) / 5), index =>
    rect(
      left + index * 5 + (index % 2) * 2,
      top + 3,
      1,
      FACE_HEIGHT - 3,
      BACKSPLASH_GROUT_COLOR,
    ),
  ),
  ...Array.makeBy(Math.floor((right - left) / 14), index =>
    rect(
      left + index * 14 + Math.floor(roll(index, 21) * 9),
      top + FACE_HEIGHT - 5 + Math.floor(roll(index, 22) * 3),
      3,
      3,
      BACKSPLASH_GRIME_COLOR,
    ),
  ),
  rect(left, top, right - left, 1, '#5a6658'),
]

const POT_PIXELS: ReadonlyArray<string> = [
  '..h..',
  '.ccc.',
  'cCCCc',
  'cCCCc',
  '.ccc.',
]

const PAN_PIXELS: ReadonlyArray<string> = [
  'h....',
  'h....',
  'h....',
  'IIII.',
  'IiiII',
  '.III.',
]

const LADLE_PIXELS: ReadonlyArray<string> = ['h.', 'h.', 'h.', 'h.', 'hh', 'ss']

const HANGING_PALETTE: Palette = {
  h: '#8a8a96',
  c: COPPER_COLOR,
  C: COPPER_LIGHT_COLOR,
  I: IRON_COLOR,
  i: IRON_LIGHT_COLOR,
  s: '#b8b8c4',
}

// NOTE: a rail of hanging pots, a pan, and a ladle in the gaps between the
// pantry, the ovens, the back door, and the sink.
const hangingPots = (rail: Span, top: number): ReadonlyArray<Canvas.Shape> => {
  const middle = Math.floor((rail.left + rail.right) / 2)
  return [
    rect(rail.left, top + 2, rail.right - rail.left, 1, RAIL_COLOR),
    ...pixelArt(middle - 7, top + 3, POT_PIXELS, HANGING_PALETTE),
    ...pixelArt(middle - 1, top + 3, PAN_PIXELS, HANGING_PALETTE),
    ...pixelArt(middle + 5, top + 3, LADLE_PIXELS, HANGING_PALETTE),
  ]
}

const faceSpans = (level: Level): ReadonlyArray<Span> => {
  const backDoor = tilesWithSymbol(level, 'D')
  const doorLeft = Math.min(...Array.map(backDoor, ({ column }) => column))
  const doorRight = Math.max(...Array.map(backDoor, ({ column }) => column)) + 1
  return Array.isReadonlyArrayEmpty(backDoor)
    ? [{ left: TILE_SIZE, right: 19 * TILE_SIZE }]
    : [
        { left: TILE_SIZE, right: doorLeft * TILE_SIZE },
        { left: doorRight * TILE_SIZE, right: 19 * TILE_SIZE },
      ]
}

const cobweb = (
  x: number,
  y: number,
  isLeft: boolean,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(6, index =>
    rect(
      isLeft ? x + index : x - index - 1,
      y + (5 - index),
      1,
      1,
      COBWEB_COLOR,
    ),
  )

export const kitchenWallShapes = (level: Level): ReadonlyArray<Canvas.Shape> =>
  Option.match(kitchenBox(level), {
    onNone: () => [],
    onSome: box => {
      const top = box.y + FACE_TOP
      return [
        ...Array.flatMap(faceSpans(level), span => backsplash(top, span)),
        ...hangingPots({ left: 41, right: 59 }, top),
        ...hangingPots({ left: 81, right: 99 }, top),
        ...hangingPots({ left: 141, right: 159 }, top),
        ...cobweb(TILE_SIZE, box.y + TILE_SIZE * 2, true),
        ...cobweb(19 * TILE_SIZE, box.y + TILE_SIZE * 2, false),
      ]
    },
  })

// COVER

// NOTE: a cast iron stove against the wall, its back plate and stove pipe up
// the tiles, a pot of the same green soup on the top, and an oven door whose
// little window glows while the oven is ready to belch.
export const ovenShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  const topY = y - 2
  return [
    rect(x + 13, y - 20, 3, 8, IRON_DARK_COLOR),
    rect(x + 13, y - 20, 1, 8, IRON_EDGE_COLOR),
    rect(x + 2, y - 14, width - 4, 12, IRON_COLOR),
    rect(x + 2, y - 14, width - 4, 1, IRON_EDGE_COLOR),
    rect(x + 4, y - 11, width - 8, 1, IRON_LIGHT_COLOR),
    rect(x, topY, width, 8, IRON_DARK_COLOR),
    rect(x, topY, width, 1, IRON_EDGE_COLOR),
    rect(x + 3, topY + 2, 5, 4, '#0e0e12'),
    rect(x + 12, topY + 2, 5, 4, '#0e0e12'),
    rect(x + 11, topY - 3, 7, 6, '#5a5a66'),
    rect(x + 12, topY - 3, 5, 2, SOUP_LIGHT_COLOR),
    rect(x + 13, topY - 4, 1, 1, SOUP_LIGHT_COLOR),
    rect(x, y + 6, width, bottom - y - 7, IRON_COLOR),
    rect(x, y + 6, width, 1, IRON_LIGHT_COLOR),
    rect(x + 3, y + 8, width - 6, 10, IRON_EDGE_COLOR),
    rect(x + 4, y + 9, width - 8, 8, IRON_DARK_COLOR),
    rect(x + 6, y + 10, width - 12, 4, '#140c0c'),
    rect(x + 5, y + 7, width - 10, 1, '#8a8a96'),
    rect(x + 1, bottom - 1, 2, 1, IRON_DARK_COLOR),
    rect(x + width - 3, bottom - 1, 2, 1, IRON_DARK_COLOR),
  ]
}

// NOTE: a long butcher's table with the night's menu on it: a green ham, a
// picked fish, a cleaver, a jar of eyeballs, and a pie with a hand in it.
export const prepTableShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  return [
    rect(x, y + 1, width, height - 4, WOOD_COLOR),
    rect(x, y + 1, width, 1, WOOD_LIGHT_COLOR),
    ...Array.makeBy(Math.floor(width / 6), index =>
      rect(x + 3 + index * 6, y + 3, 1, height - 7, WOOD_DARK_COLOR),
    ),
    rect(x, bottom - 3, width, 3, WOOD_DARK_COLOR),
    rect(x + 1, bottom - 1, 2, 1, INK_COLOR),
    rect(x + width - 3, bottom - 1, 2, 1, INK_COLOR),
    rect(x + 5, y + 4, 9, 6, '#6a8a3a'),
    rect(x + 6, y + 4, 7, 2, '#8aac4a'),
    rect(x + 13, y + 6, 3, 2, BONE_COLOR),
    rect(x + 20, y + 7, 12, 1, BONE_COLOR),
    ...Array.makeBy(4, index =>
      rect(x + 22 + index * 2, y + 5, 1, 5, BONE_COLOR),
    ),
    rect(x + 31, y + 6, 3, 3, BONE_COLOR),
    rect(x + 32, y + 7, 1, 1, INK_COLOR),
    rect(x + 37, y + 3, 6, 3, '#b8b8c4'),
    rect(x + 42, y + 4, 4, 1, WOOD_DARK_COLOR),
    rect(x + 36, y + 8, 4, 3, BLOOD_COLOR),
    rect(x + 48, y + 3, 5, 7, 'rgba(180, 210, 190, 0.6)'),
    rect(x + 49, y + 5, 1, 1, '#f4f1de'),
    rect(x + 51, y + 7, 1, 1, '#f4f1de'),
    rect(x + 50, y + 6, 1, 1, '#3d4f7a'),
    rect(x + 48, y + 2, 5, 1, '#8a8090'),
    rect(x + 54, y + 9, 5, 5, '#c08a4a'),
    rect(x + 55, y + 9, 3, 1, '#d8a868'),
    rect(x + 56, y + 6, 1, 3, SKIN_COLOR),
    rect(x + 55, y + 5, 3, 1, SKIN_COLOR),
    rect(x + 8, y + 12, 5, 2, BLOOD_COLOR),
  ]
}

// NOTE: a porcelain sink of grey water with a zombie's hand bobbing in it,
// dirty plates stacked beside it, and a tap that never stops dripping.
export const sinkShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  return [
    rect(x + 12, y - 8, 2, 7, '#8a8a96'),
    rect(x + 10, y - 9, 6, 2, '#b8b8c4'),
    rect(x, y, width, height - 2, PORCELAIN_SHADE_COLOR),
    rect(x, y, width, 1, PORCELAIN_COLOR),
    rect(x + 2, y + 2, 18, 12, PORCELAIN_COLOR),
    rect(x + 4, y + 4, 14, 8, '#4a5a4a'),
    rect(x + 5, y + 5, 3, 1, '#6a7a6a'),
    rect(x + 11, y + 6, 4, 3, SKIN_COLOR),
    rect(x + 10, y + 5, 1, 2, SKIN_COLOR),
    rect(x + 12, y + 5, 1, 1, SKIN_COLOR),
    rect(x + 14, y + 5, 1, 1, SKIN_COLOR),
    rect(x + 22, y + 3, 7, 2, '#efe6d2'),
    rect(x + 22, y + 5, 7, 2, '#d8d0bc'),
    rect(x + 23, y + 7, 6, 2, '#efe6d2'),
    rect(x + 24, y + 8, 2, 1, '#8a6a2a'),
    rect(x, bottom - 2, width, 2, '#6a6a72'),
  ]
}

const JAR_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#7aa04a',
  '#c08a4a',
  '#a04a5a',
  '#5a7aa0',
  '#d8c070',
]

// NOTE: the pantry cupboard stands open up the wall: shelves of pickled
// things, a jar of brains, and a string of garlic for all the good it does.
export const pantryShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  const top = y - 16
  const shelves = [top + 8, top + 16, top + 24]
  return [
    rect(x, top, width, bottom - top, CABINET_COLOR),
    rect(x - 1, top - 1, width + 2, 2, '#6a4a30'),
    rect(x + 2, top + 2, width - 4, 26, CABINET_DARK_COLOR),
    ...Array.flatMap(shelves, (shelfY, shelf) => [
      ...Array.makeBy(5, index =>
        rect(
          x + 3 + index * 5,
          shelfY - 4,
          3,
          4,
          JAR_COLORS[(shelf * 2 + index) % JAR_COLORS.length] ?? '#7aa04a',
        ),
      ),
      rect(x + 2, shelfY, width - 4, 1, '#6a4a30'),
    ]),
    rect(x + 14, top + 3, 4, 3, '#e0a0b0'),
    rect(x + 15, top + 3, 1, 1, '#c07080'),
    rect(x + 3, bottom - 8, width - 6, 6, '#3a2618'),
    rect(x + width / 2 - 1, bottom - 6, 2, 1, '#c9a06a'),
    rect(x + 5, top + 2, 1, 7, '#e8e2cc'),
    rect(x + 4, top + 9, 3, 2, '#e8e2cc'),
  ]
}

// NOTE: Mystery Leftovers: a grimy old fridge against the back wall, its
// cream gone yellow, rust round the feet, mold creeping out of the door
// seal, a smiley magnet, and a padlocked chain hanging loose. Its door
// opening is drawn over it (src/features/fridge/fridgeView.ts).
const FRIDGE_COLOR = '#d6cfa4'
const FRIDGE_SHADE_COLOR = '#a89f74'
const FRIDGE_DARK_COLOR = '#6e6648'
const FRIDGE_CHROME_COLOR = '#c9ced6'
const MOLD_COLOR = '#7aa04a'
const MOLD_DARK_COLOR = '#4e6a2a'
const RUST_COLOR = '#8a4a24'
export const FRIDGE_RISE_PX = 18

export const fridgeShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  const top = y - FRIDGE_RISE_PX
  const freezerBottom = top + 11
  return [
    rect(x + 1, top - 1, width - 2, 1, FRIDGE_DARK_COLOR),
    rect(x, top, width, bottom - top - 1, FRIDGE_COLOR),
    rect(x, top, 1, bottom - top - 1, FRIDGE_SHADE_COLOR),
    rect(x + width - 2, top, 2, bottom - top - 1, FRIDGE_SHADE_COLOR),
    rect(x + 1, freezerBottom, width - 3, 1, FRIDGE_DARK_COLOR),
    rect(x + width - 5, top + 3, 1, 6, FRIDGE_CHROME_COLOR),
    rect(x + width - 5, freezerBottom + 3, 1, 12, FRIDGE_CHROME_COLOR),
    rect(x + 3, top + 2, 3, 3, '#ffd23f'),
    rect(x + 4, top + 3, 1, 1, INK_COLOR),
    rect(x + 7, top + 5, 2, 2, '#ff7ab8'),
    rect(x + 3, freezerBottom + 4, 5, 6, '#f4f1de'),
    rect(x + 4, freezerBottom + 5, 3, 1, '#8a8a96'),
    rect(x + 4, freezerBottom + 7, 2, 1, '#8a8a96'),
    rect(x + 1, freezerBottom + 1, width - 3, 1, MOLD_COLOR),
    rect(x + 3, freezerBottom + 2, 1, 2, MOLD_COLOR),
    rect(x + 9, freezerBottom + 2, 1, 3, MOLD_DARK_COLOR),
    rect(x + 13, freezerBottom + 2, 1, 1, MOLD_COLOR),
    rect(x + 1, bottom - 4, width - 3, 1, MOLD_DARK_COLOR),
    rect(x + 6, bottom - 3, 2, 1, MOLD_COLOR),
    rect(x + 11, top + 6, 2, 3, 'rgba(90, 80, 30, 0.45)'),
    rect(x + 2, bottom - 2, width - 3, 1, RUST_COLOR),
    rect(x + 1, bottom - 1, 3, 1, RUST_COLOR),
    rect(x + width - 4, bottom - 1, 3, 1, RUST_COLOR),
  ]
}

export const sacksShapes = ({
  x,
  y,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const bottom = y + height
  return [
    rect(x + 1, y - 4, 8, bottom - y + 3, BURLAP_COLOR),
    rect(x + 3, y - 6, 4, 2, BURLAP_DARK_COLOR),
    rect(x + 2, y, 6, 1, BURLAP_DARK_COLOR),
    rect(x + 10, y - 2, 9, bottom - y + 1, BURLAP_COLOR),
    rect(x + 12, y - 4, 5, 2, BURLAP_DARK_COLOR),
    rect(x + 15, y + 3, 3, 3, FLOUR_COLOR),
    rect(x + 13, bottom - 1, 8, 2, FLOUR_COLOR),
    rect(x + 18, bottom, 4, 1, 'rgba(232, 226, 212, 0.6)'),
  ]
}

// DOORS

const splinters = (
  x: number,
  y: number,
  seed: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(7, index =>
    rect(
      x + Math.floor(roll(seed, index) * 22),
      y + Math.floor(roll(seed, index + 9) * 6),
      roll(seed, index + 18) < 0.5 ? 2 : 1,
      roll(seed, index + 18) < 0.5 ? 1 : 2,
      index % 3 === 0 ? CASING_COLOR : '#9a7048',
    ),
  )

// NOTE: the kitchen's back door: the frame with a screen door torn half off
// its hinge, the night showing through.
export const backDoorShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  const bottom = y + height
  return [
    rect(x, y, width, height, DOOR_DARK_COLOR),
    rect(x + 2, y + 4, width - 4, 6, '#101820'),
    rect(x - 3, y + FACE_TOP, 3, height - FACE_TOP, CASING_COLOR),
    rect(x - 1, y + FACE_TOP + 2, 1, height - FACE_TOP - 2, CASING_LIGHT_COLOR),
    rect(right, y + FACE_TOP, 3, height - FACE_TOP, CASING_COLOR),
    rect(right, y + FACE_TOP + 2, 1, height - FACE_TOP - 2, CASING_DARK_COLOR),
    rect(x - 4, y + FACE_TOP - 1, width + 8, 3, CASING_COLOR),
    rect(x - 4, y + FACE_TOP - 1, width + 8, 1, CASING_LIGHT_COLOR),
    rect(x + 1, y + 5, 6, 12, 'rgba(150, 160, 170, 0.35)'),
    rect(x + 1, y + 5, 6, 1, '#5a4030'),
    rect(x + 1, y + 16, 6, 1, '#5a4030'),
    rect(x + 1, y + 5, 1, 12, '#5a4030'),
    rect(x + 6, y + 6, 1, 10, '#5a4030'),
    rect(right - 4, y + 8, 3, 7, '#4a3020'),
    ...splinters(x - 1, bottom + 1, 31),
  ]
}

// NOTE: the kitchen's broken window: shards left in the frame, a torn
// curtain, and the glass all over the floor inside.
export const windowShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const inner = x + width
  return [
    rect(x, y, width, height, NIGHT_COLOR),
    rect(x, y - 3, width, 3, CASING_COLOR),
    rect(x, y - 1, width, 1, CASING_LIGHT_COLOR),
    rect(x, y + height, width, 3, CASING_COLOR),
    rect(x, y + height, width, 1, CASING_DARK_COLOR),
    rect(x + 1, y, 3, 4, GLASS_COLOR),
    rect(x + 1, y + 4, 2, 2, GLASS_COLOR),
    rect(x + 5, y + height - 5, 3, 5, GLASS_COLOR),
    rect(x + 6, y + height - 7, 2, 2, GLASS_COLOR),
    rect(inner, y - 2, 2, 9, CURTAIN_COLOR),
    rect(inner + 2, y - 2, 1, 5, CURTAIN_COLOR),
    rect(inner, y + height - 6, 2, 8, CURTAIN_COLOR),
    ...Array.makeBy(7, index =>
      rect(
        inner + 1 + Math.floor(roll(index, 41) * 9),
        y + Math.floor(roll(index, 42) * height),
        1,
        1,
        GLASS_COLOR,
      ),
    ),
  ]
}

// NOTE: an exit bought open is a doorway with its casing still up and the
// smashed boards lying on both sides of it.
export const openedExitShapes = ({
  x,
  y,
  width,
  height,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const right = x + width
  const bottom = y + height
  return [
    rect(x - 3, y, 3, height, CASING_COLOR),
    rect(x - 1, y, 1, height, CASING_LIGHT_COLOR),
    rect(right, y, 3, height, CASING_COLOR),
    rect(right, y, 1, height, CASING_DARK_COLOR),
    rect(x - 4, y + FACE_TOP - 1, 4, 3, CASING_COLOR),
    rect(right, y + FACE_TOP - 1, 4, 3, CASING_COLOR),
    rect(x - 6, bottom + 3, 11, 3, PLANK_COLOR),
    rect(x - 6, bottom + 5, 11, 1, PLANK_DARK_COLOR),
    rect(right - 3, bottom + 6, 9, 3, PLANK_COLOR),
    rect(right - 3, bottom + 8, 9, 1, PLANK_DARK_COLOR),
    rect(x + 4, y - 6, 3, 9, PLANK_COLOR),
    rect(x + 12, y - 8, 8, 3, PLANK_COLOR),
    rect(x + 12, y - 6, 8, 1, PLANK_DARK_COLOR),
    ...splinters(x - 2, bottom + 1, 51),
    ...splinters(x - 2, y - 8, 52),
  ]
}

// PADLOCK

// NOTE: before the kitchen's first break a padlock hangs at the foot of the
// boards. From then on the price tag is the purchasable's
// (src/features/shop/purchaseView.ts).
const PADLOCK: Sprite = spriteShapes(
  [
    '...c...',
    '..kkk..',
    '.k...k.',
    '.k...k.',
    'kGGGGGk',
    'kGgDgGk',
    'kGgDgGk',
    'kGGGGGk',
    '.kkkkk.',
  ],
  { c: '#c9c3b0', k: '#140c10', G: '#e0b040', g: '#b8862a', D: '#140c10' },
  TOP_LEFT,
)

const LOCK_BOARD_Y = 22

export const padlockShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Option.match(maybePadlockedExit(model), {
    onNone: () => [],
    onSome: box => [
      placeAt(
        Math.round((box.left + box.right) / 2) - 3,
        box.top + LOCK_BOARD_Y,
        PADLOCK,
      ),
    ],
  })

// OVENS

export const isKitchenShown = (model: Model): boolean =>
  Array.some(
    levelOf(model).rooms,
    ({ id, isOpen }) => id === 'Kitchen' && isOpen,
  )

const GLOW_PULSE_MS = 900
const FLAME_FRAME_MS = 90
const FLAME_FRAMES = 3

const FLAME_PALETTE: Palette = {
  Y: '#fff2a0',
  y: '#ffe066',
  O: '#ff9a2a',
  R: '#e0482a',
  D: '#a02818',
}

const flameWidth = (row: number, rows: number, frame: number): number => {
  const along = row / rows
  const swell = Math.sin(Math.PI * Math.min(1, along * 1.25))
  const flicker = Math.floor(roll(row, frame + 60) * 3)
  return Math.max(2, Math.round(7 + swell * 15 - along * 5) - flicker)
}

const flameRow = (
  row: number,
  rows: number,
  frame: number,
  span: number,
): string => {
  const width = flameWidth(row, rows, frame)
  const shift = Math.round((roll(row, frame + 90) - 0.5) * 2)
  const left = Math.floor((span - width) / 2) + shift
  return pipe(
    Array.makeBy(span, column => {
      const offset = column - left
      if (offset < 0 || offset >= width) {
        return '.'
      }
      const edge = Math.min(offset, width - 1 - offset) / Math.max(1, width / 2)
      const isTip = row > rows * 0.8 && roll(row * 31 + column, frame) < 0.35
      if (isTip) {
        return '.'
      } else if (edge > 0.6 && row < rows * 0.75) {
        return row < rows * 0.3 ? 'Y' : 'y'
      } else if (edge > 0.3) {
        return 'O'
      } else if (row > rows * 0.7) {
        return 'D'
      } else {
        return 'R'
      }
    }),
    Array.join(''),
  )
}

const FLAME_SPAN = 24

const flamePixels = (rows: number, frame: number): ReadonlyArray<string> =>
  Array.makeBy(rows, row => flameRow(row, rows, frame, FLAME_SPAN))

const FLAME_SPRITES: Array.NonEmptyReadonlyArray<Sprite> = [
  spriteShapes(flamePixels(OVEN_RULES.reachPx, 0), FLAME_PALETTE, TOP_LEFT),
  ...Array.makeBy(FLAME_FRAMES - 1, index =>
    spriteShapes(
      flamePixels(OVEN_RULES.reachPx, index + 1),
      FLAME_PALETTE,
      TOP_LEFT,
    ),
  ),
]

type OvenBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const windowOf = (box: OvenBox): Box => ({
  x: box.left + 6,
  y: box.top + 10,
  width: box.right - box.left - 12,
  height: 4,
})

const glowShapes = (
  oven: Oven,
  box: OvenBox,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const glass = windowOf(box)
  return Oven.match(oven, {
    Ready: () => {
      const pulse =
        Math.round(
          (0.55 + 0.45 * Math.sin((Math.PI * 2 * elapsedMs) / GLOW_PULSE_MS)) *
            10,
        ) / 10
      return [
        rect(glass.x, glass.y, glass.width, glass.height, '#ff8a2a'),
        Canvas.Rect({
          x: glass.x + 1,
          y: glass.y + 1,
          width: glass.width - 2,
          height: 2,
          fill: `rgba(255, 224, 102, ${pulse})`,
        }),
        Canvas.Rect({
          x: box.left + 2,
          y: box.bottom,
          width: box.right - box.left - 4,
          height: 3,
          fill: `rgba(255, 140, 40, ${Math.round(pulse * 3) / 10})`,
        }),
      ]
    },
    Belching: () => [
      rect(glass.x, glass.y, glass.width, glass.height, '#fff2a0'),
    ],
    Cooling: ({ remainingMs }) => [
      rect(
        glass.x,
        glass.y,
        glass.width,
        glass.height,
        remainingMs > OVEN_RULES.cooldownMs / 2 ? '#5a1a10' : '#3a120c',
      ),
    ],
  })
}

const flameShapes = (
  oven: Oven,
  box: OvenBox,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Oven.isAnyOf(['Belching'])(oven)
    ? [
        placeAt(
          Math.round((box.left + box.right) / 2 - FLAME_SPAN / 2),
          flameBoxOf(box).top - 2,
          Option.getOrElse(
            Array.get(
              FLAME_SPRITES,
              Math.floor(elapsedMs / FLAME_FRAME_MS) % FLAME_SPRITES.length,
            ),
            () => FLAME_SPRITES[0],
          ),
        ),
      ]
    : []

// NOTE: drawn on the scene canvas under the actors: each oven's window,
// glowing while it is ready to belch, white hot while it does, and banked
// down to embers while it cools.
export const ovenGlowShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  const boxes = ovenBoxesOf(levelOf(model))
  if (!isKitchenShown(model)) {
    return []
  }
  const ovens = ovensOf(model)
  return Array.flatMap(boxes, (box, index) =>
    Option.match(Array.get(ovens, index), {
      onNone: () => [],
      onSome: oven => glowShapes(oven, box, model.elapsedMs),
    }),
  )
}

// NOTE: drawn over the actors, so a zombie caught in a belch stands in the
// fire.
export const ovenFlameShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (!isKitchenShown(model)) {
    return []
  }
  const boxes = ovenBoxesOf(levelOf(model))
  const ovens = ovensOf(model)
  return Array.flatMap(boxes, (box, index) =>
    Option.match(Array.get(ovens, index), {
      onNone: () => [],
      onSome: oven => flameShapes(oven, box, model.elapsedMs),
    }),
  )
}
