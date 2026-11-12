import { Array, Option, String, pipe } from 'effect'
import { Canvas } from 'foldkit'

import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  placeAt,
  spriteShapes,
} from '../art/sprite'
import { flameZoneOf, isValveLit, valveBoxOf } from '../world/kitchen/gasValve'
import { levelOf } from '../world/level/arena'
import type { Box } from '../world/level/tileGrid'
import type { World } from '../world/schema/world'
import type { GunPerk } from '../world/schema/worldSchema'

// The art of the kitchen's stove bench and gas valve (src/world/kitchen/stove.ts,
// src/world/kitchen/gasValve.ts): the perks' little icons, which the stove's tag and a
// cooked gun's HUD slot wear; the valve wheel on the kitchen's east wall;
// and the roaring hearth the lit valve feeds, its flames licking the floor
// in front of it. Every fixed picture is a sprite built once here; the
// flames on the floor change every frame, so they stay rectangles.

const INK = '#140c10'

// THE PERKS

// NOTE: a chili for Spicy, a curl of crispy bacon for Crispy, and a
// drumstick for Hearty, each 7 by 7.
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

// NOTE: the stove's tag shows what cooking does in a picture: a gun wearing
// the perk as a sticker on its grip, just as a cooked gun's HUD slot wears
// it (src/screens/game/hud.ts).
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

// THE VALVE

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

// NOTE: a red wheel on the gas pipe up the wall, shut; turned, it goes
// green and a blue pilot flame burns beside it.
const VALVE_SHUT: Sprite = spriteShapes(
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
    '.....PP.....',
    '.....PP.....',
    '.....PP.....',
  ],
  VALVE_PALETTE,
  TOP_LEFT,
)

const VALVE_LIT: Sprite = spriteShapes(
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
    '.....PP.....',
    '.....PP.....',
    '.....PP.....',
  ],
  VALVE_PALETTE,
  TOP_LEFT,
)

// NOTE: the valve's tag leads with a flame, what it buys.
export const FLAME_ICON: Sprite = spriteShapes(
  ['...Y...', '..YO...', '..YOY..', '.YORO..', '.ORROY.', 'YORWROY', '.ORRRO.'],
  FIRE_PALETTE,
  TOP_LEFT,
)

const VALVE_INSET_PX = 2

const valveShapes = (model: World): ReadonlyArray<Canvas.Shape> =>
  Option.match(valveBoxOf(levelOf(model)), {
    onNone: () => [],
    onSome: box => [
      placeAt(
        box.left + VALVE_INSET_PX,
        box.top + 1,
        isValveLit(model) ? VALVE_LIT : VALVE_SHUT,
      ),
    ],
  })

// THE ROARING HEARTH

// NOTE: the lit valve's fire fills the whole fireplace and spills over its
// slab: two frames, wider and taller than the hearth's own little fire.
const ROAR_FRAMES: Array.NonEmptyReadonlyArray<Sprite> = [
  spriteShapes(
    [
      '......Y.......Y.........Y.......Y......',
      '.....YO......YO....Y...YO......YOY.....',
      '..Y..OO..Y...OR...YO...OR..Y...ORO..Y..',
      '..OY.OR.YO..YRR..YOO..YRR.YO..YRRO.YO..',
      '.YOOYORRYOY.ORRYOORRY.ORROOOY.ORRRYOO..',
      '.ORRORRRORROORRORRRRROORRRRRORRRRRORRY.',
      'YORRRRWRRRRRRRRRRWWRRRRRRWRRRRRRWRRRRO.',
      'ORRWWWWWRRDRRWWWWWWWRRDRWWWWRRDRWWWWRRO',
      'ORRDWWWRRDDDRRWWWWRRDDDRRWWRDDDRRWWRDRR',
      'RRDDDRRDDDDDDDRRRRDDDDDDDRRDDDDDDRRDDRR',
      '.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD.',
    ],
    FIRE_PALETTE,
    TOP_LEFT,
  ),
  spriteShapes(
    [
      '...Y.......Y........Y.......Y.......Y..',
      '...OY.....YO....Y..YO...Y...OY.....YO..',
      '.Y.ROY..Y.OR...YO..RO..YO...ROY..Y.OR..',
      '.OYRRO..OYRR..YOR.YRR..OR..YRRO..OYRR..',
      '.ORRRY.YORRROYORRYORRYOORYOORRRY.ORRRY.',
      'YRRRRROORRRRRORRRRRRRROORRRRRRRROORRRRY',
      'ORRWRRRRRRWWRRRRRWRRRRRRRWWRRRRRRRWRRRO',
      'ORWWWWRRDRWWWWWRRWWWRRDRWWWWWRRDRWWWWRO',
      'RRDWWRRDDDRWWWRRDDWRRDDDRRWWRRDDDRWWRDR',
      'RRDDDRRDDDDDDDRRDDDDDDDDDRRDDDDDDDRRDDR',
      '.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD.',
    ],
    FIRE_PALETTE,
    TOP_LEFT,
  ),
]

const ROAR_WIDTH = 39
const ROAR_HEIGHT = 11
const ROAR_FRAME_MS = 110

// NOTE: the fire sits on the logs, inside the firebox's 52 px opening,
// a little above the slab.
const ROAR_LIFT_PX = 5

// NOTE: the flames that lick the floor in front of the hearth, where the
// fire burns: each tongue rises and fades over its own beat, spread across
// the zone by its index, so the zone reads as fire without a word.
const TONGUES = 14
const TONGUE_MS = 520
const TONGUE_COLORS: Array.NonEmptyReadonlyArray<string> = [
  '#fff6c8',
  '#ffe066',
  '#ff9a2a',
  '#e0482a',
  '#a02818',
]
const FLOOR_GLOW = 'rgba(255, 120, 30, 0.16)'

const tongueShapes = (
  zone: Box,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const width = zone.right - zone.left
  const depth = zone.bottom - zone.top
  return Array.makeBy(TONGUES, index => {
    const beat = elapsedMs / TONGUE_MS + index * 0.37
    const round = Math.floor(beat)
    const age = beat - round
    const x = zone.left + ((index * 23 + round * 17) % width)
    const y = zone.bottom - 2 - age * (depth + 6)
    const size = age < 0.5 ? 2 : 1
    return Canvas.Rect({
      x: Math.round(x),
      y: Math.round(y),
      width: size,
      height: size + 1,
      fill: Option.getOrElse(
        Array.get(TONGUE_COLORS, Math.floor(age * TONGUE_COLORS.length)),
        () => TONGUE_COLORS[0],
      ),
    })
  })
}

const roarShapes = (
  zone: Box,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => [
  Canvas.Rect({
    x: zone.left,
    y: zone.top,
    width: zone.right - zone.left,
    height: zone.bottom - zone.top,
    fill: FLOOR_GLOW,
  }),
  placeAt(
    Math.round((zone.left + zone.right - ROAR_WIDTH) / 2),
    zone.top - ROAR_HEIGHT - ROAR_LIFT_PX,
    Option.getOrElse(
      Array.get(
        ROAR_FRAMES,
        Math.floor(elapsedMs / ROAR_FRAME_MS) % ROAR_FRAMES.length,
      ),
      () => ROAR_FRAMES[0],
    ),
  ),
  ...tongueShapes(zone, elapsedMs),
]

const hearthRoarShapes = (model: World): ReadonlyArray<Canvas.Shape> =>
  isValveLit(model)
    ? Option.match(flameZoneOf(levelOf(model)), {
        onNone: () => [],
        onSome: zone => roarShapes(zone, model.elapsedMs),
      })
    : []

// NOTE: drawn on the ground, under the actors: the valve on its wall and,
// once it is turned, the fire over the hearth and on its floor.
export const kitchenGearGroundShapes = (
  model: World,
): ReadonlyArray<Canvas.Shape> => [
  ...valveShapes(model),
  ...hearthRoarShapes(model),
]
