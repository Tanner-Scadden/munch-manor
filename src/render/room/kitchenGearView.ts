import { Array, Option, String, pipe } from 'effect'

import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  deepSprite,
  glowingSprite,
  placeAt,
  spriteShapes,
} from '#art/sprite.ts'
import type { Drawable } from '#render/depth.ts'
import * as Draw from '#render/draw.ts'
import { flameZoneOf, isValveLit, valveBoxOf } from '#world/kitchen/gasValve.ts'
import { levelOf } from '#world/level/arena.ts'
import type { Box } from '#world/level/tileGrid.ts'
import type { World } from '#world/schema/world.ts'
import type { GunPerk } from '#world/schema/worldSchema.ts'

import { FIRE_WIDTH, type FireSpot, fireSpotOf } from './room.ts'

const INK = '#140c10'

const PERK_PIXELS: Readonly<Record<GunPerk, ReadonlyArray<string>>> = {
  Spicy: [
    '.....g.',
    '....gg.',
    '...RR..',
    '..RRr..',
    '.RRr...',
    'RRR....',
    '.R.....',
  ],
  Crispy: [
    'BB.....',
    'BbB....',
    '.BbB...',
    '..BbBB.',
    '...BbbB',
    '....BbB',
    '.....BB',
  ],
  Hearty: [
    '..MMM..',
    '.MMmMM.',
    '.MmMMM.',
    '..MMM..',
    '...W...',
    '..W.W..',
    '.......',
  ],
}

const PERK_PALETTE: Palette = {
  g: '#6fae4a',
  R: '#e0482a',
  r: '#ff9a7a',
  B: '#a8482a',
  b: '#ffb070',
  M: '#b8703a',
  m: '#e8a060',
  W: '#f4f1de',
}

export const PERK_ICON_SIZE = 7

export const PERK_ICONS: Readonly<Record<GunPerk, Sprite>> = {
  Spicy: spriteShapes(PERK_PIXELS.Spicy, PERK_PALETTE, TOP_LEFT),
  Crispy: spriteShapes(PERK_PIXELS.Crispy, PERK_PALETTE, TOP_LEFT),
  Hearty: spriteShapes(PERK_PIXELS.Hearty, PERK_PALETTE, TOP_LEFT),
}

const COOKED_GUN_PIXELS: ReadonlyArray<string> = [
  '..............',
  '..............',
  '.....KKKKKKKKK',
  '.....KGHHHHHHG',
  '.....KGGGGGKKK',
  '.....KGGK.....',
  '.....KKK......',
]

const COOKED_GUN_PALETTE: Palette = {
  ...PERK_PALETTE,
  K: INK,
  G: '#5d6672',
  H: '#b8c0cc',
}

const withSticker = (perk: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.map(COOKED_GUN_PIXELS, (row, y) =>
    pipe(
      String.split(row, ''),
      Array.map((pixel, x) =>
        pipe(
          Array.get(perk, y),
          Option.flatMap(perkRow => String.at(perkRow, x)),
          Option.filter(perkPixel => perkPixel !== '.'),
          Option.getOrElse(() => pixel),
        ),
      ),
      Array.join(''),
    ),
  )

export const COOKED_GUN_ICON_WIDTH = 14

export const COOKED_GUN_ICONS: Readonly<Record<GunPerk, Sprite>> = {
  Spicy: spriteShapes(
    withSticker(PERK_PIXELS.Spicy),
    COOKED_GUN_PALETTE,
    TOP_LEFT,
  ),
  Crispy: spriteShapes(
    withSticker(PERK_PIXELS.Crispy),
    COOKED_GUN_PALETTE,
    TOP_LEFT,
  ),
  Hearty: spriteShapes(
    withSticker(PERK_PIXELS.Hearty),
    COOKED_GUN_PALETTE,
    TOP_LEFT,
  ),
}

const FIRE_PALETTE: Palette = {
  W: '#fff6c8',
  Y: '#ffe066',
  O: '#ff9a2a',
  R: '#e0482a',
  D: '#a02818',
}

const VALVE_PALETTE: Palette = {
  K: INK,
  P: '#6a6a74',
  p: '#9a9aa6',
  R: '#d8302a',
  r: '#ff7a6a',
  G: '#5ab04a',
  g: '#a8e080',
  B: '#4aa8ff',
  b: '#c8ecff',
}

const PIPE_ROWS: ReadonlyArray<string> = Array.makeBy(8, () => '.....PP.....')
const FLANGE_ROWS: ReadonlyArray<string> = ['....KpPK....', '...KPPPPK...']

const VALVE_SHUT: Sprite = deepSprite(
  spriteShapes(
    [
      '.....PP.....',
      '...KKpPKK...',
      '..KRRRRRRK..',
      '.KRrKRRKrRK.',
      '.KRKRKKRKRK.',
      '.KRRKppKRRK.',
      '.KRRKppKRRK.',
      '.KRKRKKRKRK.',
      '.KRrKRRKrRK.',
      '..KRRRRRRK..',
      '...KKpPKK...',
      ...PIPE_ROWS,
      ...FLANGE_ROWS,
    ],
    VALVE_PALETTE,
    TOP_LEFT,
  ),
  { most: 2 },
)

const VALVE_LIT: Sprite = deepSprite(
  spriteShapes(
    [
      '.....PP...b.',
      '...KKpPKKbB.',
      '..KGGGGGGKB.',
      '.KGgKGGKgGK.',
      '.KGKGKKGKGK.',
      '.KGGKppKGGK.',
      '.KGGKppKGGK.',
      '.KGKGKKGKGK.',
      '.KGgKGGKgGK.',
      '..KGGGGGGK..',
      '...KKpPKK...',
      ...PIPE_ROWS,
      ...FLANGE_ROWS,
    ],
    VALVE_PALETTE,
    TOP_LEFT,
  ),
  { most: 2 },
)

const VALVE_HEIGHT = 21

export const FLAME_ICON: Sprite = spriteShapes(
  ['...Y...', '..YO...', '..YOY..', '.YORO..', '.ORROY.', 'YORWROY', '.ORRRO.'],
  FIRE_PALETTE,
  TOP_LEFT,
)

const VALVE_FACE_COLUMN = 10

const valveDrawables = (model: World): ReadonlyArray<Drawable> =>
  Option.match(valveBoxOf(levelOf(model)), {
    onNone: () => [],
    onSome: box => [
      {
        footY: box.bottom,
        rank: 'Prop',
        shapes: [
          placeAt(
            box.left - VALVE_FACE_COLUMN - 1,
            box.bottom - VALVE_HEIGHT,
            isValveLit(model) ? VALVE_LIT : VALVE_SHUT,
          ),
        ],
      },
    ],
  })

const roarSprite = (pixels: ReadonlyArray<string>): Sprite =>
  glowingSprite(
    deepSprite(spriteShapes(pixels, FIRE_PALETTE, TOP_LEFT), {
      most: 1,
      isUpright: true,
    }),
  )

const ROAR_FRAMES: Array.NonEmptyReadonlyArray<Sprite> = [
  roarSprite([
    '.Y.......Y.........Y.......Y',
    'YO......YO....Y...YO......YO',
    'OO..Y...OR...YO...OR..Y...OR',
    'OR.YO..YRR..YOO..YRR.YO..YRR',
    'ORRYOY.ORRYOORRY.ORROOOY.ORR',
    'RRRORROORRORRRRROORRRRRORRRR',
    'RWRRRRRRRRRRWWRRRRRRWRRRRRRW',
    'WWWRRDRRWWWWWWWRRDRWWWWRRDRW',
    'WWRRDDDRRWWWWRRDDDRRWWRDDDRR',
    'RRDDDDDDDRRRRDDDDDDDRRDDDDDD',
    '.DDDDDDDDDDDDDDDDDDDDDDDDDD.',
  ]),
  roarSprite([
    '......Y........Y.......Y....',
    '.....YO....Y..YO...Y...OY...',
    'Y..Y.OR...YO..RO..YO...ROY..',
    'O..OYRR..YOR.YRR..OR..YRRO..',
    'Y.YORRROYORRYORRYOORYOORRRY.',
    'ROORRRRRORRRRRRRROORRRRRRRRO',
    'RRRRRWWRRRRRWRRRRRRRWWRRRRRR',
    'WRRDRWWWWWRRWWWRRDRWWWWWRRDR',
    'RRDDDRWWWRRDDWRRDDDRRWWRRDDD',
    'RRDDDDDDDRRDDDDDDDDDRRDDDDDD',
    '.DDDDDDDDDDDDDDDDDDDDDDDDDD.',
  ]),
]

const ROAR_WIDTH = 28
const ROAR_FRAME_MS = 110

const TONGUES = 14
const TONGUE_MS = 520
const TONGUE_RISE_PX = 9
const TONGUE_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#fff6c8',
  '#ffe066',
  '#ff9a2a',
  '#e0482a',
  '#a02818',
]
const FLOOR_GLOW = 'rgba(255, 120, 30, 0.16)'

const tongueDrawables = (
  zone: Box,
  elapsedMs: number,
): ReadonlyArray<Drawable> => {
  const width = zone.right - zone.left
  const depth = zone.bottom - zone.top
  return Array.makeBy(TONGUES, index => {
    const beat = elapsedMs / TONGUE_MS + index * 0.37
    const round = Math.floor(beat)
    const age = beat - round
    const x = zone.left + ((index * 23 + round * 17) % width)
    const footY = zone.top + 1 + ((index * 11 + round * 7) % (depth - 1))
    const size = age < 0.5 ? 2 : 1
    return {
      footY,
      rank: 'Glow',
      shapes: [
        Draw.Rect({
          x,
          y: footY - size - 1 - Math.round(age * TONGUE_RISE_PX),
          width: size,
          height: size + 1,
          fill: Option.getOrElse(
            Array.get(TONGUE_COLORS, Math.floor(age * TONGUE_COLORS.length)),
            () => TONGUE_COLORS[0],
          ),
        }),
      ],
    }
  })
}

const roarDrawable = (spot: FireSpot, elapsedMs: number): Drawable => ({
  footY: spot.footY + 1,
  rank: 'Prop',
  shapes: [
    placeAt(
      spot.x + Math.floor((FIRE_WIDTH - ROAR_WIDTH) / 2),
      spot.y,
      Option.getOrElse(
        Array.get(
          ROAR_FRAMES,
          Math.floor(elapsedMs / ROAR_FRAME_MS) % ROAR_FRAMES.length,
        ),
        () => ROAR_FRAMES[0],
      ),
    ),
  ],
})

const roarDrawables = (model: World): ReadonlyArray<Drawable> =>
  isValveLit(model)
    ? Option.match(flameZoneOf(levelOf(model)), {
        onNone: () => [],
        onSome: zone => [
          ...Array.fromOption(
            Option.map(fireSpotOf(levelOf(model)), spot =>
              roarDrawable(spot, model.elapsedMs),
            ),
          ),
          ...tongueDrawables(zone, model.elapsedMs),
        ],
      })
    : []

export const kitchenGearGroundShapes = (
  model: World,
): ReadonlyArray<Draw.Shape> =>
  isValveLit(model)
    ? Option.match(flameZoneOf(levelOf(model)), {
        onNone: () => [],
        onSome: zone => [
          Draw.Rect({
            x: zone.left,
            y: zone.top,
            width: zone.right - zone.left,
            height: zone.bottom - zone.top,
            fill: FLOOR_GLOW,
          }),
        ],
      })
    : []

export const kitchenGearDrawables = (model: World): ReadonlyArray<Drawable> => [
  ...valveDrawables(model),
  ...roarDrawables(model),
]
