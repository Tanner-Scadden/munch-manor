import { Array, Option, Record, String, pipe } from 'effect'

import type { WeaponKind } from '../model'
import type { GunSkin } from '../playerData'
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

export const GUN_TIER_TRIMS: ReadonlyArray<Palette> = [
  {},
  { H: '#9be3ff' },
  { H: '#ff9df0', M: '#7a3fa0' },
  { G: '#e0a92e', H: '#fff3a0', M: '#a8741a' },
]

// NOTE: a gun skin (the Look tab's gear row) swaps the guns' body colors:
// the metal (G, H, M), the wood (W, V), the Peashooter's green (P, Q), and
// the Pan's black (D). The outline (K) and the shotgun's red tip stay. A
// tier's trim lies over a skin, so a skinned gun still shows its tier.
type SkinnedGunSkin = Exclude<GunSkin, 'Stock'>

const GUN_SKIN_TRIMS: Readonly<Record<SkinnedGunSkin, Palette>> = {
  Gold: {
    G: '#d9a521',
    H: '#fff1a8',
    M: '#a8741a',
    W: '#c78d1e',
    V: '#8a5a12',
    P: '#d9a521',
    Q: '#fff1a8',
    D: '#a8741a',
  },
  Candy: {
    G: '#e8484a',
    H: '#ffffff',
    M: '#ffc9d2',
    W: '#ffffff',
    V: '#d8423a',
    P: '#e8484a',
    Q: '#ffffff',
    D: '#b52a34',
  },
  Slime: {
    G: '#59c23a',
    H: '#d6ff9a',
    M: '#2f8a2a',
    W: '#7ed957',
    V: '#2f8a2a',
    P: '#2f8a2a',
    Q: '#d6ff9a',
    D: '#2f8a2a',
  },
  Bone: {
    G: '#e8e2cc',
    H: '#fffdf2',
    M: '#bfb69a',
    W: '#d8d0b4',
    V: '#a39a7c',
    P: '#d8d0b4',
    Q: '#fffdf2',
    D: '#bfb69a',
  },
  Neon: {
    G: '#ff4fc3',
    H: '#9ff9ff',
    M: '#19d3e6',
    W: '#19d3e6',
    V: '#0fa0b3',
    P: '#ff4fc3',
    Q: '#ffa8e6',
    D: '#b2308f',
  },
}

const withTrim = (base: Palette, trim: Palette): Palette =>
  Record.union(base, trim, (_base, trimmed) => trimmed)

const skinPalette = (skin: GunSkin): Palette =>
  skin === 'Stock' ? GUN_PALETTE : withTrim(GUN_PALETTE, GUN_SKIN_TRIMS[skin])

const gunPalette = (tier: number, skin: GunSkin = 'Stock'): Palette =>
  Option.match(Array.get(GUN_TIER_TRIMS, tier), {
    onNone: () => skinPalette(skin),
    onSome: trim => withTrim(skinPalette(skin), trim),
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

const turnAt = (
  turns: Array.NonEmptyReadonlyArray<Sprite>,
  angle: number,
): Sprite => {
  const step = (Math.PI * 2) / GUN_DIRECTIONS
  const index =
    ((Math.round(angle / step) % GUN_DIRECTIONS) + GUN_DIRECTIONS) %
    GUN_DIRECTIONS
  return Option.getOrElse(Array.get(turns, index), () =>
    Array.headNonEmpty(turns),
  )
}

// NOTE: a skinned gun's turns are built the first time they are held, as the
// player's own look is. The stock guns are built when this module loads, so
// the sprite atlas has them.
const skinnedTurns = new Map<string, Array.NonEmptyReadonlyArray<Sprite>>()

const skinnedTurnsOf = (
  key: string,
  gun: GunPixels,
  palette: Palette,
): Array.NonEmptyReadonlyArray<Sprite> =>
  Option.getOrElse(Option.fromNullishOr(skinnedTurns.get(key)), () => {
    const built = gunTurns(gun, palette)
    skinnedTurns.set(key, built)
    return built
  })

export const knifeSprite = (angle: number, skin: GunSkin = 'Stock'): Sprite =>
  turnAt(
    skin === 'Stock'
      ? KNIFE_TURNS
      : skinnedTurnsOf(`${skin}.Knife`, KNIFE_IN_HAND, skinPalette(skin)),
    angle,
  )

const GUN_ICONS: Readonly<Record<WeaponKind, ReadonlyArray<Sprite>>> =
  Record.map(GUN_PIXELS, ({ pixels }) =>
    Array.map(GUN_TIERS, tier => spriteShapes(pixels, gunPalette(tier))),
  )

// NOTE: a gun's icon, flat: the stock one is made as the module loads.
const skinnedIcons = new Map<string, Sprite>()

export const gunIcon = (
  kind: WeaponKind,
  tier: number,
  skin: GunSkin = 'Stock',
): Sprite => {
  if (skin !== 'Stock') {
    const key = `${skin}.${kind}.${tier}`
    return Option.getOrElse(Option.fromNullishOr(skinnedIcons.get(key)), () => {
      const built = spriteShapes(
        GUN_PIXELS[kind].pixels,
        gunPalette(tier, skin),
      )
      skinnedIcons.set(key, built)
      return built
    })
  }
  return pipe(
    Array.get(GUN_ICONS[kind], tier),
    Option.orElse(() => Array.head(GUN_ICONS[kind])),
    Option.getOrElse(() => []),
  )
}

export const gunSprite = (
  kind: WeaponKind,
  tier: number,
  angle: number,
  skin: GunSkin = 'Stock',
): Sprite => {
  if (skin !== 'Stock') {
    return turnAt(
      skinnedTurnsOf(
        `${skin}.${kind}.${tier}`,
        GUN_PIXELS[kind],
        gunPalette(tier, skin),
      ),
      angle,
    )
  }
  const turns = Option.getOrElse(Array.get(GUN_SPRITES[kind], tier), () =>
    Option.getOrElse(Array.head(GUN_SPRITES[kind]), () =>
      gunTurns(GUN_PIXELS[kind], GUN_PALETTE),
    ),
  )
  return turnAt(turns, angle)
}

// NOTE: a gun as pixels and colors, for the Look tab's option: the Pop
// Pistol in a skin.
export const gunPictureOf = (
  kind: WeaponKind,
  skin: GunSkin,
): Readonly<{ rows: ReadonlyArray<string>; palette: Palette }> => ({
  rows: GUN_PIXELS[kind].pixels,
  palette: gunPalette(0, skin),
})
