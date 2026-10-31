import { Array, Option, Record, String, pipe } from 'effect'

import type { WeaponKind } from '../model'
import {
  type Anchor,
  type Palette,
  type Sprite,
  TRANSPARENT,
  spriteShapes,
  spriteWidth,
} from '../sprite'

// GUNS

const GUN_PALETTE: Palette = {
  K: '#26262e',
  G: '#8d96a3',
  H: '#d9dde3',
  W: '#8a5a2b',
  V: '#5c3a1a',
  M: '#4a4f5a',
  R: '#d8423a',
  P: '#4f9a32',
  Q: '#9be36a',
  D: '#2e2e36',
  B: '#4ab8f0',
  C: '#c8f4ff',
  N: '#ff7ab8',
}

type GunPixels = Readonly<{ pixels: ReadonlyArray<string>; pivot: Anchor }>

const GUN_PIXELS: Readonly<Record<WeaponKind, GunPixels>> = {
  Pistol: {
    pixels: ['HGGGG', 'GKK..', 'K....'],
    pivot: { x: 0, y: 1 },
  },
  Shotgun: {
    pixels: ['VWWKGGGGGH', 'VW.KKRGGGG', 'V...K.....'],
    pivot: { x: 3, y: 1 },
  },
  Smg: {
    pixels: ['.KGGGGGH', 'KKKKKGG.', 'K..M....', '...M....'],
    pivot: { x: 1, y: 1 },
  },
  Peashooter: {
    pixels: ['.PPPPQQ', 'VPQQQPQ', 'VPPPPQQ'],
    pivot: { x: 1, y: 1 },
  },
  // NOTE: the fridge's prizes. The Cooker is a dented pot with its lid
  // clamped on, held by the side handle; the Pan a black skillet on a
  // wooden handle; Brain Freeze a slushie tank with a pink straw nozzle.
  Cooker: {
    pixels: ['....KHK..', '..KGGGGGK', 'RRKMMMMMK', '..KMGGGMK', '...KKKKK.'],
    pivot: { x: 1, y: 2 },
  },
  Pan: {
    pixels: [
      '.......KKK.',
      '......KDDDK',
      'VWWWWKDDHDK',
      '......KDDDK',
      '.......KKK.',
    ],
    pivot: { x: 1, y: 2 },
  },
  Freeze: {
    pixels: [
      '...NN....',
      '..KKKK...',
      '.KCCCBKKK',
      'KKBBBBGGN',
      '.KBBBBK..',
      '..KKKK...',
    ],
    pivot: { x: 1, y: 3 },
  },
}

const GUN_DIRECTIONS = 16
const STRAIGHT_UP_TOLERANCE = 1e-9

const symbolOf = (
  pixels: ReadonlyArray<string>,
  x: number,
  y: number,
): string =>
  pipe(
    Array.get(pixels, y),
    Option.flatMap(row => (x < 0 ? Option.none() : String.at(row, x))),
    Option.getOrElse(() => TRANSPARENT),
  )

const GUN_TIER_TRIMS: ReadonlyArray<Palette> = [
  {},
  { H: '#9be3ff' },
  { H: '#ff9df0', M: '#7a3fa0' },
  { G: '#e0a92e', H: '#fff3a0', M: '#a8741a' },
]

const gunPalette = (tier: number): Palette =>
  Option.match(Array.get(GUN_TIER_TRIMS, tier), {
    onNone: () => GUN_PALETTE,
    onSome: trim =>
      Record.union(GUN_PALETTE, trim, (_base, trimmed) => trimmed),
  })

const rotatedGun = (
  { pixels, pivot }: GunPixels,
  palette: Palette,
  angle: number,
): Sprite => {
  const isPointingLeft = Math.cos(angle) < -STRAIGHT_UP_TOLERANCE
  const source = isPointingLeft ? Array.reverse(pixels) : pixels
  const pivotY = isPointingLeft ? pixels.length - 1 - pivot.y : pivot.y
  const reach = Math.ceil(Math.hypot(spriteWidth(pixels), pixels.length)) + 1
  const size = reach * 2 + 1
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const rows = Array.makeBy(size, targetY =>
    pipe(
      Array.makeBy(size, targetX => {
        const dx = targetX - reach
        const dy = targetY - reach
        return symbolOf(
          source,
          Math.round(cos * dx + sin * dy + pivot.x),
          Math.round(-sin * dx + cos * dy + pivotY),
        )
      }),
      Array.join(''),
    ),
  )
  return spriteShapes(rows, palette, { x: reach, y: reach })
}

const gunTurns = (
  gun: GunPixels,
  palette: Palette,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Array.prepend(
    Array.makeBy(GUN_DIRECTIONS - 1, index =>
      rotatedGun(gun, palette, ((index + 1) * Math.PI * 2) / GUN_DIRECTIONS),
    ),
    rotatedGun(gun, palette, 0),
  )

const GUN_TIERS: ReadonlyArray<number> = Array.makeBy(
  GUN_TIER_TRIMS.length,
  tier => tier,
)

const GUN_SPRITES: Readonly<
  Record<WeaponKind, ReadonlyArray<Array.NonEmptyReadonlyArray<Sprite>>>
> = Record.map(GUN_PIXELS, gun =>
  Array.map(GUN_TIERS, tier => gunTurns(gun, gunPalette(tier))),
)

// NOTE: the knife in hand, the third slot (GAME_DESIGN.md, "The knife and
// two gun slots"): a wooden grip and a short pale blade, turned as a gun is.
const KNIFE_IN_HAND: GunPixels = {
  pixels: ['VWGGH'],
  pivot: { x: 1, y: 0 },
}

const KNIFE_TURNS = gunTurns(KNIFE_IN_HAND, GUN_PALETTE)

export const knifeSprite = (angle: number): Sprite => {
  const step = (Math.PI * 2) / GUN_DIRECTIONS
  const index =
    ((Math.round(angle / step) % GUN_DIRECTIONS) + GUN_DIRECTIONS) %
    GUN_DIRECTIONS
  return Option.getOrElse(Array.get(KNIFE_TURNS, index), () =>
    Array.headNonEmpty(KNIFE_TURNS),
  )
}

const GUN_ICONS: Readonly<Record<WeaponKind, ReadonlyArray<Sprite>>> =
  Record.map(GUN_PIXELS, ({ pixels }) =>
    Array.map(GUN_TIERS, tier => spriteShapes(pixels, gunPalette(tier))),
  )

export const gunIcon = (kind: WeaponKind, tier: number): Sprite =>
  pipe(
    Array.get(GUN_ICONS[kind], tier),
    Option.orElse(() => Array.head(GUN_ICONS[kind])),
    Option.getOrElse(() => []),
  )

export const gunSprite = (
  kind: WeaponKind,
  tier: number,
  angle: number,
): Sprite => {
  const turns = Option.getOrElse(Array.get(GUN_SPRITES[kind], tier), () =>
    Option.getOrElse(Array.head(GUN_SPRITES[kind]), () =>
      gunTurns(GUN_PIXELS[kind], GUN_PALETTE),
    ),
  )
  const step = (Math.PI * 2) / GUN_DIRECTIONS
  const index =
    ((Math.round(angle / step) % GUN_DIRECTIONS) + GUN_DIRECTIONS) %
    GUN_DIRECTIONS
  return Option.getOrElse(Array.get(turns, index), () =>
    Array.headNonEmpty(turns),
  )
}
