import { Array, Option, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { shownHatOf } from './closet'
import { HAT_ART, HAT_COLORS, MAX_HAT_ABOVE, NO_HAT } from './hatArt'
import {
  type Appearance,
  Body,
  type Calling,
  HairColor,
  HairStyle,
  Outfit,
  Print,
  ShirtColor,
  SkinTone,
} from './playerData'
import { type Seeded, nextRandom } from './prng'
import {
  type Palette,
  type SpriteFrames,
  TRANSPARENT,
  padRow,
  recordedSpriteSources,
  spriteFrames,
} from './sprite'

// OPTIONS

// NOTE: every part works with every body: nothing here is tied to anything
// else (decided with the owner on 2026-10-30, see "Character" in
// GAME_DESIGN.md). The lists come straight from the Schemas, so the picker,
// the dice, and the save always agree.
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

// PALETTES

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

// NOTE: six tones, lightest to deepest, evenly spaced in CIELAB lightness
// (from L* 89 down to L* 30, about 11.8 apart) on one warm hue line, so no
// step is bigger than the next.
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
}

// NOTE: the Rainbow print, the six stripes of the pride flag in their real
// colors. A torso is six pixels wide and three tall, so the stripes stand
// upright across the shirt, one column each; the picker's swatch shows
// them as the flag is flown.
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
const TOQUE_BAND_COLOR = '#c9c3ad'

const channel = (color: string, index: number): number =>
  Number.parseInt(color.slice(1 + index * 2, 3 + index * 2), 16)

const hexByte = (value: number): string =>
  Math.round(value).toString(16).padStart(2, '0')

// NOTE: a color between two others, `amount` of the way from the first.
const mix = (from: string, to: string, amount: number): string =>
  `#${[0, 1, 2]
    .map(index =>
      hexByte(
        channel(from, index) +
          (channel(to, index) - channel(from, index)) * amount,
      ),
    )
    .join('')}`

// NOTE: the symbols a player's pixel maps use. The Rainbow print's stripes
// are the digits 0 to 5, one per column of the torso.
const RAINBOW_SYMBOLS = '012345'

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
    N: TOQUE_BAND_COLOR,
    ...HAT_COLORS,
    ...Object.fromEntries(
      Array.map(RAINBOW_STRIPES, (color, index) => [
        RAINBOW_SYMBOLS.charAt(index),
        color,
      ]),
    ),
  }
}

// PIXEL PARTS

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

// NOTE: the face is six rows; row 4 holds the eyes and row 5 the chin. The
// torso starts on row 6, so a beard can hang onto the chest.
const TORSO_ROW = 6

// NOTE: the outfit's top, the six pixels between the hand (column 0) and
// the gun strap (column 7), for each of the torso's three rows. B and D are
// the shirt and its shade, and only they take a print.
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

const bare = (row: string): string => row.replaceAll('L', 'S')

// NOTE: a dress ends in one hem row, wider than the hips, over bare legs.
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
    legs: mapLegs(PANTS, row => row.replaceAll('L', 'O')),
  },
}

// NOTE: where the hand is, by frame: on the torso's top, middle, or bottom
// row as the arm swings.
type HandRow = 0 | 1 | 2

const torsoRows = (top: OutfitArt['top'], hand: HandRow): Rows =>
  Array.map(
    top,
    (middle, y) => `${y === hand ? 'S' : '.'}${middle}${y === 0 ? '.' : 'G'}`,
  )

// NOTE: the idle breath squashes the torso to its top and bottom rows.
const exhaleRows = (top: OutfitArt['top']): Rows => [
  `S${top[0]}G`,
  `.${top[2]}G`,
]

// BODY SHAPES

const setAt = (row: string, x: number, symbol: string): string =>
  `${row.slice(0, x)}${symbol}${row.slice(x + 1)}`

// NOTE: legs apart, as standing or in a stride, are `.XX..XX.` in the
// pants' own symbol; Slim draws them one pixel thin.
const LEGS_APART = /^\.(.)\1\.\.\1\1\.$/

const slimLeg = (row: string): string =>
  LEGS_APART.test(row) ? `..${row.charAt(1)}..${row.charAt(1)}..` : row

// NOTE: Slim narrows the shoulders a pixel each side, the raised hand
// coming in with them.
const slimShoulders = (row: string): string => {
  const narrowed = setAt(setAt(row, 1, TRANSPARENT), 6, TRANSPARENT)
  return row.charAt(0) === 'S'
    ? setAt(setAt(narrowed, 0, TRANSPARENT), 1, 'S')
    : narrowed
}

// NOTE: Broad fills the empty pixel each side of the shoulders with the
// shirt beside it; a raised hand stays where it is.
const broadShoulders = (row: string): string => {
  const widen = (line: string, x: number, from: number) =>
    line.charAt(x) === TRANSPARENT ? setAt(line, x, line.charAt(from)) : line
  return widen(widen(row, 0, 1), 7, 6)
}

// NOTE: a body is a silhouette, never a sex. Broad squares the shoulders
// out a pixel each side of the figure the game always drew; Slim narrows
// them and the legs. The six columns of the top stay, so a print shows
// whole on both.
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

// HAIR AND FACE

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
  // NOTE: no hair, only the shine of the scalp.
  Bald: ['........', '...U....'],
}

const BEARD: Rows = ['', '', '', '', '.H....H.', '.HHHHHH.', '..HHHH..']

// NOTE: glasses sit one column off center, as the face looks the way the
// gun points.
const GLASSES: Rows = ['', '', '', '', '.RERRER.']

// CALLING PROPS

// NOTE: the small prop each calling wears over the player's own look, so
// the Look tab still decides the face: the Handyman's hard hat, the Track
// Star's sweatband, the Penny Pincher's green visor with a coin on it, and
// the Line Cook's toque. YOU wears nothing. Rows start at the face's first
// row and lay over the hair and glasses.
const CALLING_PROPS: Readonly<Record<Calling, Rows>> = {
  You: [],
  Handyman: ['..YYYY..', '.ZYYYYZ.'],
  TrackStar: ['', '', '.RRRRRR.'],
  PennyPincher: ['', '..VCCV..', '.VVVVVV.'],
  LineCook: ['.WWWWWW.', '.NNNNNN.'],
}

const overlayRow = (base: string, top: string): string =>
  pipe(
    String.split(base, ''),
    Array.map((symbol, x) => {
      const cover = top.charAt(x)
      return cover === '' || cover === TRANSPARENT ? symbol : cover
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

// HATS

// NOTE: a hat sits over the hair and glasses. It reaches above the head, so
// the figure's rows grow at the top and nothing below them moves: the sprite
// is anchored at its feet. A calling's prop takes the hat's place, so only
// YOU wears one (shownHatOf).
const withHat = (rows: Rows, look: Appearance, calling: Calling): Rows => {
  const hat = shownHatOf(look, calling)
  const art = hat === 'None' ? NO_HAT : HAT_ART[hat]
  return Array.isReadonlyArrayEmpty(art.rows)
    ? rows
    : overlayRows(
        [...Array.makeBy(art.above, () => BLANK_ROW), ...rows],
        art.rows,
      )
}

// PRINTS

// NOTE: a print paints the shirt's own pixels (B and D) on the torso rows:
// Stripes a white band across the middle row, Rainbow a stripe per column.
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
          Array.map((symbol, x) => {
            if (symbol !== 'B' && symbol !== 'D') {
              return symbol
            }
            if (print === 'Stripes') {
              return torsoRow === 1 ? 'W' : 'B'
            }
            return RAINBOW_SYMBOLS.charAt(Math.min(5, Math.max(0, x - 1)))
          }),
          Array.join(''),
        )
      })

// FRAMES

type FramePixels = Array.NonEmptyReadonlyArray<Rows>

type PlayerPixels = Readonly<{ walk: FramePixels; idle: FramePixels }>

export const playerPixels = (
  appearance: Appearance,
  calling: Calling = 'You',
): PlayerPixels => {
  const shape = BODY_SHAPES[appearance.body]
  const outfit = OUTFIT_ART[appearance.outfit]
  const hair = HAIR_ART[appearance.hairStyle]

  // NOTE: the torso's pixel rows read the print by their own row: the full
  // torso its three rows, the exhale its top and bottom.
  const upper = (torso: Rows, isExhale: boolean): Rows => {
    const printed = withPrint(
      [...FACE, ...shape.torso(torso, isExhale)],
      y => (isExhale && y === 1 ? 2 : y),
      appearance.print,
    )
    const bearded = appearance.beard ? overlayRows(printed, BEARD) : printed
    const haired = overlayRows(bearded, hair)
    const glassed = appearance.glasses ? overlayRows(haired, GLASSES) : haired
    return withHat(
      overlayRows(glassed, CALLING_PROPS[calling]),
      appearance,
      calling,
    )
  }
  const legs = (rows: Rows) => shape.legs(rows)
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
  }
}

// NOTE: a closet card's picture, from the room over the tallest hat down to
// the hips: the standing figure with the look's hat, its top padded so every
// hat sits at the same height from the figure's feet, and nothing under the
// torso. Rows are the standing frame's, so the hat sits as it does in a run.
// NOTE: the blank row over the head, the face's six rows, and the torso's
// three.
const HEAD_AND_TORSO_ROWS = 10

export const closetRows = (look: Appearance): Rows => {
  const grown = look.hat === 'None' ? 0 : HAT_ART[look.hat].above
  return Array.take(
    [
      ...Array.makeBy(MAX_HAT_ABOVE - grown, () => BLANK_ROW),
      ...playerPixels(look).idle[0],
    ],
    MAX_HAT_ABOVE + HEAD_AND_TORSO_ROWS,
  )
}

// SPRITES

type PlayerSprites = Readonly<{
  walk: SpriteFrames
  idle: SpriteFrames
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
  }
}

export const appearanceKey = (
  appearance: Appearance,
  calling: Calling = 'You',
): string =>
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
    shownHatOf(appearance, calling),
  ].join('.')

const SPRITE_CACHE_SIZE = 16

const spriteCache = new Map<string, PlayerSprites>()

// NOTE: the view asks for the player's sprites every frame. Building them
// means composing the pixel maps and turning them into shapes, so each look
// is built once and kept here, and the oldest look is dropped once more than
// a handful have been tried, such as by pressing Randomize over and over.
export const playerSprites = (
  appearance: Appearance,
  calling: Calling = 'You',
): PlayerSprites => {
  const key = appearanceKey(appearance, calling)
  const maybeCached = Option.fromNullishOr(spriteCache.get(key))
  if (Option.isSome(maybeCached)) {
    return maybeCached.value
  }

  const built = buildPlayerSprites(appearance, calling)
  spriteCache.set(key, built)
  if (spriteCache.size > SPRITE_CACHE_SIZE) {
    Option.map(Option.fromNullishOr(spriteCache.keys().next().value), oldest =>
      spriteCache.delete(oldest),
    )
  }
  return built
}

// NOTE: every sprite image built so far, with the given look's frames built
// first. The warm-up canvases and the loading splash read it once the game
// has loaded, so it holds the sprites of every module.
export const spriteWarmUpSources = (
  look: Appearance,
): ReadonlyArray<string> => {
  playerSprites(look)
  return recordedSpriteSources()
}

// RANDOMIZE

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

// NOTE: the dice draws every part from its full list, each as likely as the
// next, from the cosmetic generator in the Model, and never lands on the
// look already showing.
export const randomAppearance = (
  state: number,
  current: Appearance,
): Seeded<Appearance> => {
  const [afterBody, body] = pickFrom(BODIES, state)
  const [afterStyle, hairStyle] = pickFrom(HAIR_STYLES, afterBody)
  const [afterHair, hairColor] = pickFrom(HAIR_COLORS, afterStyle)
  const [afterSkin, skinTone] = pickFrom(SKIN_TONES, afterHair)
  const [afterShirt, shirtColor] = pickFrom(SHIRT_COLORS, afterSkin)
  const [afterOutfit, outfit] = pickFrom(OUTFITS, afterShirt)
  const [afterPrint, print] = pickFrom(PRINTS, afterOutfit)
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
  }
  return [
    afterGlasses,
    appearanceKey(rolled) === appearanceKey(current)
      ? modifyFields(rolled, {
          shirtColor: () => nextOption(SHIRT_COLORS, shirtColor),
        })
      : rolled,
  ]
}
