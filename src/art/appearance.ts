import { Array, Function, Option, Record, String, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { isOwned } from '../domain/closet'
import { isObjectFirst } from '../shared/dualArgs'
import {
  type Appearance,
  Body,
  type Calling,
  FreePrint,
  FreeShirtColor,
  HairColor,
  HairStyle,
  Outfit,
  Print,
  type SavedBoughtCosmetics,
  ShirtColor,
  SkinTone,
} from '../shared/playerData'
import { type Seeded, nextRandom } from '../shared/prng'
import {
  type Palette,
  type SpriteFrames,
  type SpriteSet,
  TRANSPARENT,
  padRow,
  recordedSpriteSources,
  spriteFrames,
  spriteSet,
} from './sprite'
import { HAT_ART, HAT_COLORS, MAX_HAT_ABOVE, NO_HAT } from './sprites/hatArt'
import {
  YOU_MEDAL,
  channelOf,
  propStylePalette,
  styledProp,
} from './sprites/propStyles'

export const BODIES: Array.NonEmptyReadonlyArray<Body> = Body.literals

export const HAIR_STYLES: Array.NonEmptyReadonlyArray<HairStyle> =
  HairStyle.literals

export const HAIR_COLORS: Array.NonEmptyReadonlyArray<HairColor> =
  HairColor.literals

export const SKIN_TONES: Array.NonEmptyReadonlyArray<SkinTone> =
  SkinTone.literals

export const SHIRT_COLORS: Array.NonEmptyReadonlyArray<ShirtColor> =
  ShirtColor.literals

export const OUTFITS: Array.NonEmptyReadonlyArray<Outfit> = Outfit.literals

export const PRINTS: Array.NonEmptyReadonlyArray<Print> = Print.literals

export const ON_OFF: Array.NonEmptyReadonlyArray<boolean> = [false, true]

type HairShade = Readonly<{ base: string; shine: string }>

export const HAIR_SHADES: Readonly<Record<HairColor, HairShade>> = {
  Black: { base: '#2a2233', shine: '#5e5674' },
  Brown: { base: '#6b3f1d', shine: '#8f5a2e' },
  Blonde: { base: '#e0b448', shine: '#f8dc8a' },
  Red: { base: '#c2522a', shine: '#e8803e' },
  Grey: { base: '#a9adbd', shine: '#e4e6ee' },
  Pink: { base: '#ec6cb0', shine: '#ffa8d6' },
}

type SkinShade = Readonly<{ skin: string; eye: string }>

export const SKIN_SHADES: Readonly<Record<SkinTone, SkinShade>> = {
  Fair: { skin: '#fadac2', eye: '#1b1b2a' },
  Light: { skin: '#e9b489', eye: '#1b1b2a' },
  Medium: { skin: '#cd9262', eye: '#1b1b2a' },
  Tan: { skin: '#ad7347', eye: '#140c0c' },
  Brown: { skin: '#895736', eye: '#140c0c' },
  Deep: { skin: '#613f2c', eye: '#0c0606' },
}

type ShirtShade = Readonly<{ base: string; dark: string }>

export const SHIRT_SHADES: Readonly<Record<ShirtColor, ShirtShade>> = {
  Blue: { base: '#3d7bd9', dark: '#2a5aa8' },
  Red: { base: '#d6403a', dark: '#a12a2a' },
  Yellow: { base: '#e8b830', dark: '#b8861c' },
  Teal: { base: '#2bb0a0', dark: '#1d7e74' },
  Pink: { base: '#e46aa6', dark: '#b2447c' },
  Purple: { base: '#8c5cd6', dark: '#6340a4' },
  Gold: { base: '#d8a418', dark: '#94640c' },
  Glow: { base: '#7dff3a', dark: '#3fae1c' },
  Midnight: { base: '#27315f', dark: '#141a3a' },
  Coral: { base: '#ff7f6e', dark: '#c9503f' },
  Frost: { base: '#bfe9ff', dark: '#6fa8d0' },
  Ember: { base: '#c2361a', dark: '#6e1a0e' },
}

export const RAINBOW_STRIPES: Array.NonEmptyReadonlyArray<string> = [
  '#e40303',
  '#ff8c00',
  '#ffed00',
  '#008026',
  '#004cff',
  '#732982',
]

export const STRIPE_WHITE = '#f4f1de'

const PANTS_COLOR = '#2b3550'
const DENIM_COLOR = '#4a74c4'
const SHOE_COLOR = '#141414'
const STRAP_COLOR = '#9aa3ad'
const FRAME_COLOR = '#e8443a'
const HARD_HAT_COLOR = '#f2c230'
const HARD_HAT_SHADE = '#b8861c'
const VISOR_COLOR = '#2f9e57'
const COIN_COLOR = '#ffd23f'
const FLAME_COLOR = '#ff7a1a'
const TOQUE_BAND_COLOR = '#c9c3ad'

const hexByte = (value: number): string =>
  String.padStart(2, '0')(Math.round(value).toString(16))

const mix = (from: string, to: string, amount: number): string =>
  `#${Array.join(
    Array.map([0, 1, 2], index =>
      hexByte(
        channelOf(from, index) +
          (channelOf(to, index) - channelOf(from, index)) * amount,
      ),
    ),
    '',
  )}`

const RAINBOW_SYMBOLS = '012345'

const symbolAt = (row: string, x: number, fallback: string): string =>
  Option.getOrElse(String.charAt(row, x), () => fallback)

export const playerPalette = (appearance: Appearance): Palette => {
  const hair = HAIR_SHADES[appearance.hairColor]
  const skin = SKIN_SHADES[appearance.skinTone]
  const shirt = SHIRT_SHADES[appearance.shirtColor]
  return {
    H: hair.base,
    I: hair.shine,
    S: skin.skin,
    E: skin.eye,
    T: mix(skin.skin, hair.base, 0.45),
    U: mix(skin.skin, STRIPE_WHITE, 0.4),
    B: shirt.base,
    D: shirt.dark,
    L: PANTS_COLOR,
    O: DENIM_COLOR,
    K: SHOE_COLOR,
    G: STRAP_COLOR,
    W: STRIPE_WHITE,
    R: FRAME_COLOR,
    Y: HARD_HAT_COLOR,
    Z: HARD_HAT_SHADE,
    V: VISOR_COLOR,
    C: COIN_COLOR,
    F: FLAME_COLOR,
    N: TOQUE_BAND_COLOR,
    ...HAT_COLORS,
    ...propStylePalette(appearance.propStyle),
    ...Record.fromEntries(
      Array.map(RAINBOW_STRIPES, (color, index) => [
        symbolAt(RAINBOW_SYMBOLS, index, ''),
        color,
      ]),
    ),
  }
}

export const PLAYER_WIDTH = 8

const BLANK_ROW = padRow('', PLAYER_WIDTH, 0)

type Rows = ReadonlyArray<string>

const FACE: Rows = [
  '........',
  '..SSSS..',
  '.SSSSSS.',
  '.SSSSSS.',
  '.SESSES.',
  '..SSSS..',
]

const TORSO_ROW = 6

type Legs = Readonly<{
  stand: Rows
  stride: Rows
  passFront: Rows
  passBack: Rows
}>

type OutfitArt = Readonly<{
  top: Readonly<[string, string, string]>
  legs: Legs
}>

const PANTS: Legs = {
  stand: ['.LL..LL.', '.KK..KK.'],
  stride: ['.LL..LL.', 'KK....KK'],
  passFront: ['..LLLL..', '..LL.KK.', '..KK....'],
  passBack: ['..LLLL..', '.KK.LL..', '....KK..'],
}

const mapLegs = (legs: Legs, row: (row: string) => string): Legs => ({
  stand: Array.map(legs.stand, row),
  stride: Array.map(legs.stride, row),
  passFront: Array.map(legs.passFront, row),
  passBack: Array.map(legs.passBack, row),
})

const bare = (row: string): string => String.replaceAll('L', 'S')(row)

const DRESS_LEGS: Legs = {
  stand: ['BBBBBBBB', ...Array.map(Array.drop(PANTS.stand, 1), bare)],
  stride: ['BBBBBBBB', ...Array.map(Array.drop(PANTS.stride, 1), bare)],
  passFront: ['BBBBBBBB', ...Array.map(Array.drop(PANTS.passFront, 1), bare)],
  passBack: ['BBBBBBBB', ...Array.map(Array.drop(PANTS.passBack, 1), bare)],
}

const OUTFIT_ART: Readonly<Record<Outfit, OutfitArt>> = {
  Tee: { top: ['BBDDBB', 'BBDDBB', 'BBBBBB'], legs: PANTS },
  Hoodie: { top: ['DDBBDD', 'BWBBWB', 'BDDDDB'], legs: PANTS },
  Dress: { top: ['BBSSBB', 'BDDDDB', 'BBBBBB'], legs: DRESS_LEGS },
  Overalls: {
    top: ['BOBBOB', 'BOOOOB', 'OOOOOO'],
    legs: mapLegs(PANTS, row => String.replaceAll('L', 'O')(row)),
  },
}

type HandRow = 0 | 1 | 2

const torsoRows = (top: OutfitArt['top'], hand: HandRow): Rows =>
  Array.map(
    top,
    (middle, y) => `${y === hand ? 'S' : '.'}${middle}${y === 0 ? '.' : 'G'}`,
  )

const exhaleRows = (top: OutfitArt['top']): Rows => [
  `S${top[0]}G`,
  `.${top[2]}G`,
]

type Hand = HandRow | 'Up' | 'Hidden'

const ARMS_UP_ROWS = 5

const armColumn = (hand: Hand, y: number, rest: string): string => {
  if (hand === y) {
    return 'S'
  }
  return hand === 'Up' && y === 0 ? 'B' : rest
}

const actTorsoRows = (top: OutfitArt['top'], back: Hand, front: Hand): Rows =>
  Array.map(
    top,
    (middle, y) =>
      `${armColumn(back, y, '.')}${middle}${armColumn(front, y, y === 0 ? '.' : 'G')}`,
  )

const raisedArmRows = (back: Hand, front: Hand): Rows =>
  Array.makeBy(ARMS_UP_ROWS + 1, y => {
    const symbol = y === 0 ? 'S' : 'B'
    return `${back === 'Up' ? symbol : '.'}......${front === 'Up' ? symbol : '.'}`
  })

const kneelRow = (stand: Rows): string => {
  const thigh = Option.getOrElse(
    Array.findFirst(
      String.split(
        Option.getOrElse(Array.head(stand), () => ''),
        '',
      ),
      symbol => symbol !== TRANSPARENT,
    ),
    () => 'L',
  )
  return `K${String.repeat(6)(thigh)}K`
}

const setAt = (row: string, x: number, symbol: string): string =>
  `${String.slice(0, x)(row)}${symbol}${String.slice(x + 1)(row)}`

const LEGS_APART = /^\.(.)\1\.\.\1\1\.$/

const slimLeg = (row: string): string =>
  LEGS_APART.test(row)
    ? `..${symbolAt(row, 1, '')}..${symbolAt(row, 1, '')}..`
    : row

const slimShoulders = (row: string): string => {
  const narrowed = setAt(setAt(row, 1, TRANSPARENT), 6, TRANSPARENT)
  return symbolAt(row, 0, '') === 'S'
    ? setAt(setAt(narrowed, 0, TRANSPARENT), 1, 'S')
    : narrowed
}

const broadShoulders = (row: string): string => {
  const widen = (line: string, x: number, from: number) =>
    symbolAt(line, x, '') === TRANSPARENT
      ? setAt(line, x, symbolAt(line, from, ''))
      : line
  return widen(widen(row, 0, 1), 7, 6)
}

type BodyShape = Readonly<{
  torso: (rows: Rows, isExhale: boolean) => Rows
  legs: (rows: Rows) => Rows
}>

const BODY_SHAPES: Readonly<Record<Body, BodyShape>> = {
  Broad: {
    torso: (rows, isExhale) =>
      isExhale
        ? rows
        : Array.map(rows, (row, y) => (y === 0 ? broadShoulders(row) : row)),
    legs: rows => rows,
  },
  Slim: {
    torso: (rows, isExhale) =>
      isExhale
        ? rows
        : Array.map(rows, (row, y) => (y === 0 ? slimShoulders(row) : row)),
    legs: rows => Array.map(rows, slimLeg),
  },
}

const HAIR_ART: Readonly<Record<HairStyle, Rows>> = {
  Short: ['........', '..HHHH..', '.HHHHIH.', '.H....H.'],
  Long: [
    '........',
    '..HHHH..',
    '.HHHIHH.',
    'HHH...H.',
    'HH....H.',
    'HH......',
    'HH......',
    'H.......',
  ],
  Ponytail: [
    '........',
    '..HHHH..',
    'BHHHIHH.',
    'HH....H.',
    'H.......',
    'H.......',
  ],
  Curly: ['..HHHH..', '.HHIHHH.', 'HHHHHHHH', 'HH....HH', 'H......H'],
  Mohawk: ['...HI...', '..THHT..', '.TTHHTT.', '.T....T.'],
  Bald: ['........', '...U....'],
}

const BEARD: Rows = ['', '', '', '', '.H....H.', '.HHHHHH.', '..HHHH..']

const GLASSES: Rows = ['', '', '', '', '.RERRER.']

const CALLING_PROPS: Readonly<Record<Calling, Rows>> = {
  You: [],
  Handyman: ['..YYYY..', '.ZYYYYZ.'],
  TrackStar: ['', '', '.RRRRRR.'],
  PennyPincher: ['', '..VCCV..', '.VVVVVV.'],
  LineCook: ['.WWWWWW.', '.NNNNNN.'],
}

const BODY_PROPS: Readonly<Record<Calling, Rows>> = {
  You: [],
  Handyman: ['........', '.ss.....', '.tddydd.'],
  TrackStar: ['..wwrw..', '..wrrw..', '..wwrw..'],
  PennyPincher: ['..tt.l..', '.tywt...', '.dyyd.y.'],
  LineCook: ['...ww...', '.hwwwwh.', '.wwhhww.'],
}

const SNEAKER_COLOR_SYMBOL = 'o'

const sneakered = (calling: Calling, row: string): string =>
  calling === 'TrackStar'
    ? String.replaceAll('K', SNEAKER_COLOR_SYMBOL)(row)
    : row

const overlayRow = (base: string, top: string): string =>
  pipe(
    String.split(base, ''),
    Array.map((symbol, x) => {
      const cover = symbolAt(top, x, TRANSPARENT)
      return cover === TRANSPARENT ? symbol : cover
    }),
    Array.join(''),
  )

const overlayRows = (base: Rows, top: Rows): Rows =>
  Array.map(base, (row, y) =>
    Option.match(Array.get(top, y), {
      onNone: () => row,
      onSome: cover => overlayRow(row, cover),
    }),
  )

const propsOf = (
  calling: Calling,
  appearance: Appearance,
): Readonly<{ head: Rows; body: Rows }> => {
  const style = appearance.propStyle
  const palette = playerPalette(appearance)
  const body =
    calling === 'You' && style !== 'Stock' ? YOU_MEDAL : BODY_PROPS[calling]
  return {
    head: styledProp(CALLING_PROPS[calling], style, palette),
    body: styledProp(body, style, palette),
  }
}

const withBodyProp = (
  rows: Rows,
  torsoRowOf: (y: number) => number,
  prop: Rows,
): Rows =>
  Array.isReadonlyArrayEmpty(prop)
    ? rows
    : Array.map(rows, (row, y) =>
        y < TORSO_ROW
          ? row
          : Option.match(Array.get(prop, torsoRowOf(y - TORSO_ROW)), {
              onNone: () => row,
              onSome: cover => overlayRow(row, cover),
            }),
      )

const withHat = (rows: Rows, look: Appearance): Rows => {
  const hat = look.hat
  const art = hat === 'None' ? NO_HAT : HAT_ART[hat]
  return Array.isReadonlyArrayEmpty(art.rows)
    ? rows
    : overlayRows(
        [...Array.makeBy(art.above, () => BLANK_ROW), ...rows],
        art.rows,
      )
}

const PRINT_TILES: Readonly<
  Record<'Polka' | 'Checker' | 'Skull' | 'Flames', Rows>
> = {
  Polka: ['.W..W.', 'W..W..', '.W..W.'],
  Checker: ['W.W.W.', '.W.W.W', 'W.W.W.'],
  Skull: ['.WWWW.', '.WKKW.', '..WW..'],
  Flames: ['......', '.F.CF.', 'FCFFCF'],
}

const isTilePrint = (print: Print): print is keyof typeof PRINT_TILES =>
  print in PRINT_TILES

const printSymbolAt = (
  print: Print,
  torsoRow: number,
  column: number,
  shirt: string,
): string => {
  if (print === 'Plain') {
    return shirt
  }
  if (print === 'Stripes') {
    return torsoRow === 1 ? 'W' : 'B'
  }
  if (print === 'Rainbow') {
    return symbolAt(RAINBOW_SYMBOLS, Math.min(5, Math.max(0, column)), '')
  }
  const tile = isTilePrint(print) ? PRINT_TILES[print] : []
  const symbol = symbolAt(tile[torsoRow] ?? '', column, TRANSPARENT)
  return symbol === TRANSPARENT ? shirt : symbol
}

const withPrint = (
  rows: Rows,
  torsoRowOf: (y: number) => number,
  print: Print,
): Rows =>
  print === 'Plain'
    ? rows
    : Array.map(rows, (row, y) => {
        if (y < TORSO_ROW) {
          return row
        }
        const torsoRow = torsoRowOf(y - TORSO_ROW)
        return pipe(
          String.split(row, ''),
          Array.map((symbol, x) =>
            symbol !== 'B' && symbol !== 'D'
              ? symbol
              : printSymbolAt(print, torsoRow, x - 1, symbol),
          ),
          Array.join(''),
        )
      })

export const printSwatchRows = (print: Print): Rows =>
  Array.makeBy(3, torsoRow =>
    Array.join(
      Array.makeBy(6, column => printSymbolAt(print, torsoRow, column, 'B')),
      '',
    ),
  )

type FramePixels = Array.NonEmptyReadonlyArray<Rows>

const ACT_STANCES = [
  'Reach',
  'ReachLow',
  'ReachHigh',
  'FrontUp',
  'BackUp',
  'BothUp',
  'KneelLow',
  'KneelMid',
  'KneelUp',
] as const
export type ActStance = (typeof ACT_STANCES)[number]

type StanceArt = Readonly<{ back: Hand; front: Hand; isKneeling: boolean }>

const STANCE_ART: Readonly<Record<ActStance, StanceArt>> = {
  Reach: { back: 'Hidden', front: 1, isKneeling: false },
  ReachLow: { back: 'Hidden', front: 2, isKneeling: false },
  ReachHigh: { back: 1, front: 0, isKneeling: false },
  FrontUp: { back: 2, front: 'Up', isKneeling: false },
  BackUp: { back: 'Up', front: 1, isKneeling: false },
  BothUp: { back: 'Up', front: 'Up', isKneeling: false },
  KneelLow: { back: 'Hidden', front: 2, isKneeling: true },
  KneelMid: { back: 'Hidden', front: 1, isKneeling: true },
  KneelUp: { back: 2, front: 'Up', isKneeling: true },
}

export const FRAME_ROWS = 1 + FACE.length + 3 + 2

export const frontHandOf = (
  stance: ActStance,
): Readonly<{ x: number; y: number }> => {
  const { front, isKneeling } = STANCE_ART[stance]
  const top = isKneeling ? 2 : 1
  const row =
    front === 'Up' ? top : top + FACE.length + (front === 'Hidden' ? 1 : front)
  return { x: PLAYER_WIDTH - 1 - PLAYER_WIDTH / 2, y: row - FRAME_ROWS }
}

type PlayerPixels = Readonly<{
  walk: FramePixels
  idle: FramePixels
  act: Readonly<Record<ActStance, Rows>>
}>

export const playerPixels: {
  (calling?: Calling): (appearance: Appearance) => PlayerPixels
  (appearance: Appearance, calling?: Calling): PlayerPixels
} = Function.dual(
  isObjectFirst,
  (appearance: Appearance, calling: Calling = 'You'): PlayerPixels => {
    const shape = BODY_SHAPES[appearance.body]
    const outfit = OUTFIT_ART[appearance.outfit]
    const hair = HAIR_ART[appearance.hairStyle]
    const props = propsOf(calling, appearance)

    const upper = (torso: Rows, isExhale: boolean, raised: Rows = []): Rows => {
      const torsoRowOf = (y: number) => (isExhale && y === 1 ? 2 : y)
      const printed = withBodyProp(
        withPrint(
          [...FACE, ...shape.torso(torso, isExhale)],
          torsoRowOf,
          appearance.print,
        ),
        torsoRowOf,
        props.body,
      )
      const bearded = appearance.beard ? overlayRows(printed, BEARD) : printed
      const haired = overlayRows(bearded, hair)
      const glassed = appearance.glasses ? overlayRows(haired, GLASSES) : haired
      const propped =
        appearance.hat === 'None' ? overlayRows(glassed, props.head) : glassed
      return withHat(overlayRows(propped, raised), appearance)
    }
    const legs = (rows: Rows) =>
      Array.map(shape.legs(rows), row => sneakered(calling, row))
    return {
      walk: [
        [
          BLANK_ROW,
          ...upper(torsoRows(outfit.top, 2), false),
          ...legs(outfit.legs.stride),
        ],
        [
          ...upper(torsoRows(outfit.top, 1), false),
          ...legs(outfit.legs.passFront),
        ],
        [
          BLANK_ROW,
          ...upper(torsoRows(outfit.top, 0), false),
          ...legs(outfit.legs.stride),
        ],
        [
          ...upper(torsoRows(outfit.top, 1), false),
          ...legs(outfit.legs.passBack),
        ],
      ],
      idle: [
        [
          BLANK_ROW,
          ...upper(torsoRows(outfit.top, 1), false),
          ...legs(outfit.legs.stand),
        ],
        [
          BLANK_ROW,
          BLANK_ROW,
          ...upper(exhaleRows(outfit.top), true),
          ...legs(outfit.legs.stand),
        ],
      ],
      act: Record.map(STANCE_ART, ({ back, front, isKneeling }) => {
        const raised =
          back === 'Up' || front === 'Up' ? raisedArmRows(back, front) : []
        const torso = upper(
          actTorsoRows(outfit.top, back, front),
          false,
          raised,
        )
        return isKneeling
          ? [
              BLANK_ROW,
              BLANK_ROW,
              ...torso,
              ...legs([kneelRow(outfit.legs.stand)]),
            ]
          : [BLANK_ROW, ...torso, ...legs(outfit.legs.stand)]
      }),
    }
  },
)

const HEAD_ROWS = 7

export const hatHeadRows = (look: Appearance): Rows => {
  const grown = look.hat === 'None' ? 0 : HAT_ART[look.hat].above
  return Array.take(
    [
      ...Array.makeBy(MAX_HAT_ABOVE - grown, () => BLANK_ROW),
      ...playerPixels(look).idle[0],
    ],
    MAX_HAT_ABOVE + HEAD_ROWS,
  )
}

type PlayerSprites = Readonly<{
  walk: SpriteFrames
  idle: SpriteFrames
  act: Readonly<Record<ActStance, SpriteSet>>
}>

const buildPlayerSprites = (
  appearance: Appearance,
  calling: Calling,
): PlayerSprites => {
  const pixels = playerPixels(appearance, calling)
  const palette = playerPalette(appearance)
  return {
    walk: spriteFrames(pixels.walk, palette, PLAYER_WIDTH / 2),
    idle: spriteFrames(pixels.idle, palette, PLAYER_WIDTH / 2),
    act: Record.map(pixels.act, rows =>
      spriteSet(rows, palette, PLAYER_WIDTH / 2),
    ),
  }
}

export const appearanceKey: {
  (calling?: Calling): (appearance: Appearance) => string
  (appearance: Appearance, calling?: Calling): string
} = Function.dual(
  isObjectFirst,
  (appearance: Appearance, calling: Calling = 'You'): string =>
    Array.join(
      [
        calling,
        appearance.body,
        appearance.hairStyle,
        appearance.hairColor,
        appearance.skinTone,
        appearance.shirtColor,
        appearance.outfit,
        appearance.print,
        appearance.beard ? 'Beard' : 'Shaven',
        appearance.glasses ? 'Glasses' : 'Bare',
        appearance.hat,
        appearance.propStyle,
      ],
      '.',
    ),
)

const SPRITE_CACHE_SIZE = 16

const spriteCache = new Map<string, PlayerSprites>()

export const playerSprites: {
  (calling?: Calling): (appearance: Appearance) => PlayerSprites
  (appearance: Appearance, calling?: Calling): PlayerSprites
} = Function.dual(
  isObjectFirst,
  (appearance: Appearance, calling: Calling = 'You'): PlayerSprites => {
    const key = appearanceKey(appearance, calling)
    const maybeCached = Option.fromNullishOr(spriteCache.get(key))
    if (Option.isSome(maybeCached)) {
      return maybeCached.value
    }

    const built = buildPlayerSprites(appearance, calling)
    spriteCache.set(key, built)
    if (spriteCache.size > SPRITE_CACHE_SIZE) {
      Option.map(
        Option.fromNullishOr(spriteCache.keys().next().value),
        oldest => spriteCache.delete(oldest),
      )
    }
    return built
  },
)

export const spriteWarmUpSources = (
  look: Appearance,
): ReadonlyArray<string> => {
  playerSprites(look)
  return recordedSpriteSources()
}

const pickFrom = <A>(
  options: Array.NonEmptyReadonlyArray<A>,
  state: number,
): Seeded<A> => {
  const { value, nextState } = nextRandom(state)
  const index = Math.min(options.length - 1, Math.floor(value * options.length))
  return [
    nextState,
    Option.getOrElse(Array.get(options, index), () =>
      Array.headNonEmpty(options),
    ),
  ]
}

const nextOption = <A>(options: Array.NonEmptyReadonlyArray<A>, current: A) => {
  const index = Option.getOrElse(
    Array.findFirstIndex(options, option => option === current),
    () => 0,
  )
  return Option.getOrElse(
    Array.get(options, (index + 1) % options.length),
    () => Array.headNonEmpty(options),
  )
}

const ownedOptions = <A extends string>(
  kind: 'Shirt' | 'Print',
  options: Array.NonEmptyReadonlyArray<A>,
  free: Array.NonEmptyReadonlyArray<A>,
  bought: SavedBoughtCosmetics,
  rank: number,
): Array.NonEmptyReadonlyArray<A> => {
  const owned = Array.filter(options, option =>
    isOwned(kind, option, bought, rank),
  )
  return Array.isReadonlyArrayNonEmpty(owned) ? owned : free
}

export const randomAppearance: {
  (
    current: Appearance,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): (state: number) => Seeded<Appearance>
  (
    state: number,
    current: Appearance,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): Seeded<Appearance>
} = Function.dual(
  4,
  (
    state: number,
    current: Appearance,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): Seeded<Appearance> => {
    const shirtColors = ownedOptions(
      'Shirt',
      SHIRT_COLORS,
      FreeShirtColor.literals,
      bought,
      rank,
    )
    const prints = ownedOptions(
      'Print',
      PRINTS,
      FreePrint.literals,
      bought,
      rank,
    )
    const [afterBody, body] = pickFrom(BODIES, state)
    const [afterStyle, hairStyle] = pickFrom(HAIR_STYLES, afterBody)
    const [afterHair, hairColor] = pickFrom(HAIR_COLORS, afterStyle)
    const [afterSkin, skinTone] = pickFrom(SKIN_TONES, afterHair)
    const [afterShirt, shirtColor] = pickFrom(shirtColors, afterSkin)
    const [afterOutfit, outfit] = pickFrom(OUTFITS, afterShirt)
    const [afterPrint, print] = pickFrom(prints, afterOutfit)
    const [afterBeard, beard] = pickFrom(ON_OFF, afterPrint)
    const [afterGlasses, glasses] = pickFrom(ON_OFF, afterBeard)
    const rolled: Appearance = {
      body,
      hairStyle,
      hairColor,
      skinTone,
      shirtColor,
      outfit,
      print,
      beard,
      glasses,
      hat: current.hat,
      gunSkin: current.gunSkin,
      propStyle: current.propStyle,
    }
    return [
      afterGlasses,
      appearanceKey(rolled) === appearanceKey(current)
        ? UiStruct.evolve(rolled, {
            shirtColor: () => nextOption(shirtColors, shirtColor),
          })
        : rolled,
    ]
  },
)
