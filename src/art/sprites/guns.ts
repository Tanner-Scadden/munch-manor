import { Array, Function, Option, Record, String, pipe } from 'effect'

import {
  type Anchor,
  type Palette,
  type Sprite,
  TRANSPARENT,
  spriteShapes,
  spriteWidth,
} from '#art/sprite.ts'
import type { MasterySkin } from '#shared/masteryData.ts'
import type { GunSkin } from '#shared/playerData.ts'
import type { Vector, WeaponKind } from '#world/schema/entitySchema.ts'
import { ZERO_VECTOR } from '#world/step/geometry.ts'

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
  Y: '#c9962b',
  J: '#f0cf6a',
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
  Rifle: {
    pixels: ['.....KKGGGGGGGGH', 'VWWWWWWWWYWWK...', 'VVW.K...........'],
    pivot: { x: 4, y: 1 },
  },
  Blunderbuss: {
    pixels: ['........YYJ', 'VWWWWMYYYYJ', 'VVW.K...YYJ'],
    pivot: { x: 3, y: 1 },
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

export type DrawnGunSkin = GunSkin | MasterySkin

type SkinnedGunSkin = Exclude<DrawnGunSkin, 'Stock'>

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
  Frost: {
    G: '#9fd8f5',
    H: '#f2fbff',
    M: '#5a9cc8',
    W: '#cdeefe',
    V: '#3f78a4',
    P: '#9fd8f5',
    Q: '#f2fbff',
    D: '#5a9cc8',
  },
  Ember: {
    G: '#e0521f',
    H: '#ffd36b',
    M: '#8a2410',
    W: '#ff8a3a',
    V: '#5e160a',
    P: '#e0521f',
    Q: '#ffd36b',
    D: '#8a2410',
  },
  Gilded: {
    G: '#f0c43a',
    H: '#fffbe0',
    M: '#b07c10',
    W: '#3a2418',
    V: '#1e120c',
    P: '#f0c43a',
    Q: '#fffbe0',
    D: '#b07c10',
  },
  Diamond: {
    G: '#bfefff',
    H: '#ffffff',
    M: '#6fb8d8',
    W: '#e6f8ff',
    V: '#8fd0ea',
    P: '#bfefff',
    Q: '#ffffff',
    D: '#6fb8d8',
  },
}

const withTrim = (base: Palette, trim: Palette): Palette =>
  Record.union(base, trim, (_base, trimmed) => trimmed)

const skinPalette = (skin: DrawnGunSkin): Palette =>
  skin === 'Stock' ? GUN_PALETTE : withTrim(GUN_PALETTE, GUN_SKIN_TRIMS[skin])

const gunPalette = (tier: number, skin: DrawnGunSkin = 'Stock'): Palette =>
  Option.match(Array.get(GUN_TIER_TRIMS, tier), {
    onNone: () => skinPalette(skin),
    onSome: trim => withTrim(skinPalette(skin), trim),
  })

type TurnedGun = Readonly<{ rows: ReadonlyArray<string>; reach: number }>

const turnedGun = ({ pixels, pivot }: GunPixels, angle: number): TurnedGun => {
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
  return { rows, reach }
}

const rotatedGun = (
  gun: GunPixels,
  palette: Palette,
  angle: number,
): Sprite => {
  const { rows, reach } = turnedGun(gun, angle)
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

const KNIFE_IN_HAND: GunPixels = {
  pixels: ['VWGGH'],
  pivot: { x: 1, y: 0 },
}

const KNIFE_TURNS = gunTurns(KNIFE_IN_HAND, GUN_PALETTE)

const TURN_STEP = (Math.PI * 2) / GUN_DIRECTIONS

const turnIndexOf = (angle: number): number =>
  ((Math.round(angle / TURN_STEP) % GUN_DIRECTIONS) + GUN_DIRECTIONS) %
  GUN_DIRECTIONS

export const turnAngleOf = (angle: number): number =>
  turnIndexOf(angle) * TURN_STEP

const turnAt = (
  turns: Array.NonEmptyReadonlyArray<Sprite>,
  angle: number,
): Sprite =>
  Option.getOrElse(Array.get(turns, turnIndexOf(angle)), () =>
    Array.headNonEmpty(turns),
  )

const tipOf = (gun: GunPixels, angle: number): Vector => {
  const { rows, reach } = turnedGun(gun, angle)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const best = Array.reduce(
    rows,
    { x: 0, y: 0, along: -Infinity, across: Infinity },
    (most, row, rowIndex) =>
      Array.reduce(String.split(row, ''), most, (farthest, symbol, col) => {
        if (symbol === TRANSPARENT) {
          return farthest
        }
        const x = col - reach
        const y = rowIndex - reach
        const along = x * cos + y * sin
        const across = Math.abs(y * cos - x * sin)
        return along > farthest.along + 1e-9 ||
          (Math.abs(along - farthest.along) <= 1e-9 && across < farthest.across)
          ? { x, y, along, across }
          : farthest
      }),
  )
  return { x: best.x, y: best.y }
}

const GUN_TIPS: Readonly<Record<WeaponKind, ReadonlyArray<Vector>>> =
  Record.map(GUN_PIXELS, gun =>
    Array.makeBy(GUN_DIRECTIONS, index => tipOf(gun, index * TURN_STEP)),
  )

export const gunTipOf: {
  (angle: number): (kind: WeaponKind) => Vector
  (kind: WeaponKind, angle: number): Vector
} = Function.dual(2, (kind: WeaponKind, angle: number): Vector =>
  Option.getOrElse(
    Array.get(GUN_TIPS[kind], turnIndexOf(angle)),
    () => ZERO_VECTOR,
  ),
)

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

const isAngleFirst = (args: IArguments): boolean => typeof args[0] === 'number'

export const knifeSprite: {
  (skin?: GunSkin): (angle: number) => Sprite
  (angle: number, skin?: GunSkin): Sprite
} = Function.dual(
  isAngleFirst,
  (angle: number, skin: GunSkin = 'Stock'): Sprite =>
    turnAt(
      skin === 'Stock'
        ? KNIFE_TURNS
        : skinnedTurnsOf(`${skin}.Knife`, KNIFE_IN_HAND, skinPalette(skin)),
      angle,
    ),
)

const GUN_ICONS: Readonly<Record<WeaponKind, ReadonlyArray<Sprite>>> =
  Record.map(GUN_PIXELS, ({ pixels }) =>
    Array.map(GUN_TIERS, tier => spriteShapes(pixels, gunPalette(tier))),
  )

const skinnedIcons = new Map<string, Sprite>()

const isKindFirst = (args: IArguments): boolean => typeof args[0] === 'string'

export const gunIcon: {
  (tier: number, skin?: DrawnGunSkin): (kind: WeaponKind) => Sprite
  (kind: WeaponKind, tier: number, skin?: DrawnGunSkin): Sprite
} = Function.dual(
  isKindFirst,
  (kind: WeaponKind, tier: number, skin: DrawnGunSkin = 'Stock'): Sprite => {
    if (skin !== 'Stock') {
      const key = `${skin}.${kind}.${tier}`
      return Option.getOrElse(
        Option.fromNullishOr(skinnedIcons.get(key)),
        () => {
          const built = spriteShapes(
            GUN_PIXELS[kind].pixels,
            gunPalette(tier, skin),
          )
          skinnedIcons.set(key, built)
          return built
        },
      )
    }
    return pipe(
      Array.get(GUN_ICONS[kind], tier),
      Option.orElse(() => Array.head(GUN_ICONS[kind])),
      Option.getOrElse(() => []),
    )
  },
)

export const gunSprite: {
  (
    tier: number,
    angle: number,
    skin?: DrawnGunSkin,
  ): (kind: WeaponKind) => Sprite
  (kind: WeaponKind, tier: number, angle: number, skin?: DrawnGunSkin): Sprite
} = Function.dual(
  isKindFirst,
  (
    kind: WeaponKind,
    tier: number,
    angle: number,
    skin: DrawnGunSkin = 'Stock',
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
  },
)

export const gunPictureOf: {
  (
    skin: DrawnGunSkin,
  ): (
    kind: WeaponKind,
  ) => Readonly<{ rows: ReadonlyArray<string>; palette: Palette }>
  (
    kind: WeaponKind,
    skin: DrawnGunSkin,
  ): Readonly<{ rows: ReadonlyArray<string>; palette: Palette }>
} = Function.dual(
  2,
  (
    kind: WeaponKind,
    skin: DrawnGunSkin,
  ): Readonly<{ rows: ReadonlyArray<string>; palette: Palette }> => ({
    rows: GUN_PIXELS[kind].pixels,
    palette: gunPalette(0, skin),
  }),
)
