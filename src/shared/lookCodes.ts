import { Array, Option, Schema, SchemaGetter, String } from 'effect'

import {
  Appearance,
  GunSkin,
  type HairColor,
  type HairStyle,
  Hat,
  Outfit,
  PreHatAppearance,
  PreSkinAppearance,
  Print,
  PropStyle,
  ShirtColor,
  SkinTone,
} from './playerData'

// NOTE: a look as the save writes it, whose newest parts may be missing
// (read as their defaults), which the older shapes encode from.
type EncodedLook = typeof Appearance.Encoded

// The look's older shapes, read as the current one, and the look as the
// co-op lobby carries it (its code), apart from the save's Schemas in
// src/shared/playerData.ts so each file holds one job. Shared with the sync
// Worker, so it imports only `effect` and its own folder.

// OLDER LOOKS

const oneOf = <A extends string>(
  options: ReadonlyArray<A>,
  value: string,
  fallback: A,
): A =>
  Option.getOrElse(
    Array.findFirst(options, option => option === value),
    () => fallback,
  )

// NOTE: the first look, until 2026-10-30 (save versions 1 to 9, the player
// scope's rows, ChangedAppearance version 1, and five word co-op codes): a
// Female or Male body and five parts. Both bodies drew the same width, so
// both read as Broad in a tee, the closest new look.
const LEGACY_HAIR_STYLES = ['Crop', 'Long', 'Ponytail', 'Curls'] as const
const LEGACY_HAIR_COLORS = [
  'Black',
  'Brown',
  'Ginger',
  'Blonde',
  'Pink',
] as const

const LegacyAppearance = Schema.Struct({
  body: Schema.Literals(['Female', 'Male']),
  hairStyle: Schema.Literals(LEGACY_HAIR_STYLES),
  hairColor: Schema.Literals(LEGACY_HAIR_COLORS),
  skinTone: SkinTone,
  shirtColor: ShirtColor,
})
type LegacyAppearance = typeof LegacyAppearance.Type

const HAIR_STYLE_OF_LEGACY: Readonly<
  Record<(typeof LEGACY_HAIR_STYLES)[number], HairStyle>
> = { Crop: 'Short', Long: 'Long', Ponytail: 'Ponytail', Curls: 'Curly' }

const HAIR_COLOR_OF_LEGACY: Readonly<
  Record<(typeof LEGACY_HAIR_COLORS)[number], HairColor>
> = {
  Black: 'Black',
  Brown: 'Brown',
  Ginger: 'Red',
  Blonde: 'Blonde',
  Pink: 'Pink',
}

const appearanceOfLegacy = (look: LegacyAppearance): Appearance => ({
  body: 'Broad',
  hairStyle: HAIR_STYLE_OF_LEGACY[look.hairStyle],
  hairColor: HAIR_COLOR_OF_LEGACY[look.hairColor],
  skinTone: look.skinTone,
  shirtColor: look.shirtColor,
  outfit: 'Tee',
  print: 'Plain',
  beard: false,
  glasses: false,
  hat: 'None',
  gunSkin: 'Stock',
  propStyle: 'Stock',
})

const legacyOfAppearance = (look: EncodedLook): LegacyAppearance => ({
  body: 'Male',
  hairStyle: oneOf(LEGACY_HAIR_STYLES, look.hairStyle, 'Crop'),
  hairColor: oneOf(LEGACY_HAIR_COLORS, look.hairColor, 'Brown'),
  skinTone: look.skinTone,
  shirtColor: look.shirtColor,
})

// NOTE: the many-part look that shipped for a few hours on 2026-10-30
// (save version 10, ChangedAppearance version 2, six word co-op codes with
// five letters), before the owner chose this simpler set. Each part reads
// as its closest simple option: the Slim body stays Slim and the others
// are Broad, a pride flag is the Rainbow print, and a beard, goatee, or
// mustache is a beard.
const V10_BODIES = ['Slim', 'Medium', 'Broad', 'Round'] as const
const V10_HAIR_STYLES = [
  'Crop',
  'Long',
  'Ponytail',
  'Curls',
  'Bob',
  'Undercut',
  'Mohawk',
  'Buns',
  'Buzz',
  'Bald',
] as const
const V10_HAIR_COLORS = [
  'Black',
  'Brown',
  'Ginger',
  'Blonde',
  'Pink',
  'Silver',
  'Blue',
  'Purple',
  'Pastel',
  'Rainbow',
] as const
const V10_SKIN_TONES = [
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Bronze',
  'Brown',
  'Umber',
  'Deep',
] as const
const V10_SHIRT_COLORS = [
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
  'Orange',
  'Black',
  'White',
  'Sky',
  'Lilac',
] as const
const V10_OUTFITS = [
  'Tee',
  'Vee',
  'Tank',
  'Hoodie',
  'Crop',
  'Overalls',
  'Suit',
  'Dress',
  'Skirt',
  'Kilt',
] as const
const V10_PRINTS = [
  'Plain',
  'Stripes',
  'Candy',
  'Rainbow',
  'Progress',
  'Trans',
  'Bi',
  'Pan',
  'Nonbinary',
  'Lesbian',
  'Ace',
  'Aro',
  'Intersex',
] as const
const V10_FACIAL_HAIRS = [
  'None',
  'Stubble',
  'Mustache',
  'Goatee',
  'Beard',
] as const
const V10_MAKEUPS = ['None', 'Lashes', 'Lipstick', 'Glam', 'Blush'] as const
const V10_EXTRAS = ['None', 'Earrings', 'Glasses', 'Shades', 'Bow'] as const

const ManyPartAppearance = Schema.Struct({
  body: Schema.Literals(V10_BODIES),
  hairStyle: Schema.Literals(V10_HAIR_STYLES),
  hairColor: Schema.Literals(V10_HAIR_COLORS),
  skinTone: Schema.Literals(V10_SKIN_TONES),
  shirtColor: Schema.Literals(V10_SHIRT_COLORS),
  outfit: Schema.Literals(V10_OUTFITS),
  print: Schema.Literals(V10_PRINTS),
  facialHair: Schema.Literals(V10_FACIAL_HAIRS),
  makeup: Schema.Literals(V10_MAKEUPS),
  extra: Schema.Literals(V10_EXTRAS),
})
type ManyPartAppearance = typeof ManyPartAppearance.Type

const HAIR_STYLE_OF_V10: Readonly<
  Record<(typeof V10_HAIR_STYLES)[number], HairStyle>
> = {
  Crop: 'Short',
  Long: 'Long',
  Ponytail: 'Ponytail',
  Curls: 'Curly',
  Bob: 'Long',
  Undercut: 'Short',
  Mohawk: 'Mohawk',
  Buns: 'Ponytail',
  Buzz: 'Bald',
  Bald: 'Bald',
}

const HAIR_COLOR_OF_V10: Readonly<
  Record<(typeof V10_HAIR_COLORS)[number], HairColor>
> = {
  Black: 'Black',
  Brown: 'Brown',
  Ginger: 'Red',
  Blonde: 'Blonde',
  Pink: 'Pink',
  Silver: 'Grey',
  Blue: 'Black',
  Purple: 'Pink',
  Pastel: 'Pink',
  Rainbow: 'Pink',
}

// NOTE: by lightness: Bronze sat beside Tan, and Umber was the first
// look's Deep.
const SKIN_TONE_OF_V10: Readonly<
  Record<(typeof V10_SKIN_TONES)[number], SkinTone>
> = {
  Fair: 'Fair',
  Light: 'Light',
  Medium: 'Medium',
  Tan: 'Tan',
  Bronze: 'Tan',
  Brown: 'Brown',
  Umber: 'Deep',
  Deep: 'Deep',
}

const SHIRT_COLOR_OF_V10: Readonly<
  Record<(typeof V10_SHIRT_COLORS)[number], ShirtColor>
> = {
  Blue: 'Blue',
  Red: 'Red',
  Yellow: 'Yellow',
  Teal: 'Teal',
  Pink: 'Pink',
  Purple: 'Purple',
  Orange: 'Red',
  Black: 'Blue',
  White: 'Yellow',
  Sky: 'Blue',
  Lilac: 'Purple',
}

const OUTFIT_OF_V10: Readonly<Record<(typeof V10_OUTFITS)[number], Outfit>> = {
  Tee: 'Tee',
  Vee: 'Tee',
  Tank: 'Tee',
  Hoodie: 'Hoodie',
  Crop: 'Tee',
  Overalls: 'Overalls',
  Suit: 'Hoodie',
  Dress: 'Dress',
  Skirt: 'Dress',
  Kilt: 'Dress',
}

const printOfV10 = (print: (typeof V10_PRINTS)[number]): Print =>
  print === 'Plain' || print === 'Stripes' ? print : 'Rainbow'

const appearanceOfManyParts = (look: ManyPartAppearance): Appearance => ({
  body: look.body === 'Slim' ? 'Slim' : 'Broad',
  hairStyle: HAIR_STYLE_OF_V10[look.hairStyle],
  hairColor: HAIR_COLOR_OF_V10[look.hairColor],
  skinTone: SKIN_TONE_OF_V10[look.skinTone],
  shirtColor: SHIRT_COLOR_OF_V10[look.shirtColor],
  outfit: OUTFIT_OF_V10[look.outfit],
  print: printOfV10(look.print),
  beard:
    look.facialHair === 'Beard' ||
    look.facialHair === 'Goatee' ||
    look.facialHair === 'Mustache',
  glasses: look.extra === 'Glasses' || look.extra === 'Shades',
  hat: 'None',
  gunSkin: 'Stock',
  propStyle: 'Stock',
})

const manyPartsOfAppearance = (look: EncodedLook): ManyPartAppearance => ({
  body: look.body === 'Slim' ? 'Slim' : 'Medium',
  hairStyle: oneOf(V10_HAIR_STYLES, look.hairStyle, 'Crop'),
  hairColor: oneOf(V10_HAIR_COLORS, look.hairColor, 'Brown'),
  skinTone: look.skinTone,
  shirtColor: oneOf(V10_SHIRT_COLORS, look.shirtColor, 'Blue'),
  outfit: look.outfit,
  print: oneOf(V10_PRINTS, look.print, 'Plain'),
  facialHair: look.beard ? 'Beard' : 'None',
  makeup: 'None',
  extra: look.glasses ? 'Glasses' : 'None',
})

// NOTE: the encodings only let the older shapes sit in a union: a union
// encodes through its first member that fits, which is always Appearance.
const preHatOfAppearance = (look: EncodedLook): PreHatAppearance => ({
  body: look.body,
  hairStyle: look.hairStyle,
  hairColor: look.hairColor,
  skinTone: look.skinTone,
  shirtColor: look.shirtColor,
  outfit: look.outfit,
  print: look.print,
  beard: look.beard,
  glasses: look.glasses,
})

const PreHatToAppearance = PreHatAppearance.pipe(
  Schema.decodeTo(Appearance, {
    decode: SchemaGetter.transform((look: PreHatAppearance): Appearance => ({
      ...look,
      hat: 'None',
      gunSkin: 'Stock',
      propStyle: 'Stock',
    })),
    encode: SchemaGetter.transform(preHatOfAppearance),
  }),
)

const preSkinOfAppearance = (look: EncodedLook): PreSkinAppearance => ({
  ...preHatOfAppearance(look),
  hat: look.hat,
})

const PreSkinToAppearance = PreSkinAppearance.pipe(
  Schema.decodeTo(Appearance, {
    decode: SchemaGetter.transform((look: PreSkinAppearance): Appearance => ({
      ...look,
      gunSkin: 'Stock',
      propStyle: 'Stock',
    })),
    encode: SchemaGetter.transform(preSkinOfAppearance),
  }),
)

const LegacyToAppearance = LegacyAppearance.pipe(
  Schema.decodeTo(Appearance, {
    decode: SchemaGetter.transform(appearanceOfLegacy),
    encode: SchemaGetter.transform(legacyOfAppearance),
  }),
)

const ManyPartsToAppearance = ManyPartAppearance.pipe(
  Schema.decodeTo(Appearance, {
    decode: SchemaGetter.transform(appearanceOfManyParts),
    encode: SchemaGetter.transform(manyPartsOfAppearance),
  }),
)

// NOTE: a look as it is stored: the current shape, or an older one read as
// its closest current look. Rows and saves written before keep the old
// shape until the look next changes; writing always gives the current one.
export const StoredAppearance = Schema.Union([
  Appearance,
  PreSkinToAppearance,
  PreHatToAppearance,
  ManyPartsToAppearance,
  LegacyToAppearance,
])

// LOOK CODES

// NOTE: a look as the co-op lobby carries it (packages/netcode, Lobby.ts,
// LookInput): the first five parts as words, then one word with a letter
// per newer part, the letter of its place in its list (A for the first;
// for beard and glasses, A without and B with), joined by dots, such as
// `Slim.Mohawk.Pink.Tan.Teal.CCBA`. A hat adds one more word, the letter of
// its place in `Hat`, and only when there is one, so a bare headed look has
// the code it always had and a code without the word reads as no hat. A gun
// skin adds an eighth, the letter of its place in `GunSkin`, only when it is
// not Stock (the seventh is then the hat's, A for none). A hero's prop
// style (mastery) adds a ninth, the letter of its place in `PropStyle`,
// only when it is not Stock (the seventh and eighth are then there, A for
// none and Stock). That keeps it inside the lobby's nine words and 64
// characters, and every older code reads as it did. Older codes,
// five words from the first look or six with five letters from the
// many-part look, read as their closest current look. Anything else is
// none.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const letterOf = (options: ReadonlyArray<string>, value: string): string =>
  Option.getOrElse(
    String.charAt(LETTERS, Math.max(0, options.indexOf(value))),
    () => '',
  )

const partOfLetter = (
  options: ReadonlyArray<string>,
  letter: string,
): string | undefined => {
  const maybeIndex =
    letter.length === 1 ? String.indexOf(letter)(LETTERS) : Option.none()
  return Option.match(maybeIndex, {
    onNone: () => undefined,
    onSome: index => options[index],
  })
}

const FLAG = ['A', 'B'] as const

const flagOfLetter = (letter: string): boolean | undefined =>
  letter === 'A' ? false : letter === 'B' ? true : undefined

export const lookCodeOf = (look: Appearance): string => {
  const letters = Array.join(
    [
      letterOf(Outfit.literals, look.outfit),
      letterOf(Print.literals, look.print),
      look.beard ? FLAG[1] : FLAG[0],
      look.glasses ? FLAG[1] : FLAG[0],
    ],
    '',
  )
  const code = `${look.body}.${look.hairStyle}.${look.hairColor}.${look.skinTone}.${look.shirtColor}.${letters}`
  const withHat = `${code}.${letterOf(Hat.literals, look.hat)}`
  const withSkin = `${withHat}.${letterOf(GunSkin.literals, look.gunSkin)}`
  return look.propStyle !== 'Stock'
    ? `${withSkin}.${letterOf(PropStyle.literals, look.propStyle)}`
    : look.gunSkin !== 'Stock'
      ? withSkin
      : look.hat === 'None'
        ? code
        : withHat
}

const decodeAppearance = Schema.decodeUnknownOption(Appearance)
const decodeHat = Schema.decodeUnknownOption(Hat)
const decodeGunSkin = Schema.decodeUnknownOption(GunSkin)
const decodePropStyle = Schema.decodeUnknownOption(PropStyle)
const decodeManyParts = Schema.decodeUnknownOption(ManyPartAppearance)
const decodeLegacyAppearance = Schema.decodeUnknownOption(LegacyAppearance)

const MANY_PART_LETTERS: ReadonlyArray<ReadonlyArray<string>> = [
  V10_OUTFITS,
  V10_PRINTS,
  V10_FACIAL_HAIRS,
  V10_MAKEUPS,
  V10_EXTRAS,
]

const lookWithoutHatOfCode = (
  words: ReadonlyArray<string>,
): Option.Option<Appearance> => {
  const firstFive = {
    body: words[0],
    hairStyle: words[1],
    hairColor: words[2],
    skinTone: words[3],
    shirtColor: words[4],
  }
  const letters = String.split('')(words[5] ?? '')
  if (letters.length === MANY_PART_LETTERS.length) {
    const partAt = (index: number) =>
      partOfLetter(MANY_PART_LETTERS[index] ?? [], letters[index] ?? '')
    return Option.map(
      decodeManyParts({
        ...firstFive,
        outfit: partAt(0),
        print: partAt(1),
        facialHair: partAt(2),
        makeup: partAt(3),
        extra: partAt(4),
      }),
      appearanceOfManyParts,
    )
  }
  return letters.length === 4
    ? decodeAppearance({
        ...firstFive,
        outfit: partOfLetter(Outfit.literals, letters[0]),
        print: partOfLetter(Print.literals, letters[1] ?? ''),
        beard: flagOfLetter(letters[2] ?? ''),
        glasses: flagOfLetter(letters[3] ?? ''),
        hat: 'None',
        gunSkin: 'Stock',
        propStyle: 'Stock',
      })
    : Option.none()
}

export const lookOfCode = (code: string): Option.Option<Appearance> => {
  const words = String.split('.')(code)
  if (words.length === 5) {
    return Option.map(
      decodeLegacyAppearance({
        body: words[0],
        hairStyle: words[1],
        hairColor: words[2],
        skinTone: words[3],
        shirtColor: words[4],
      }),
      appearanceOfLegacy,
    )
  }
  if (words.length < 6 || words.length > 9) {
    return Option.none()
  }
  const maybeHat =
    words.length >= 7
      ? decodeHat(partOfLetter(Hat.literals, words[6] ?? ''))
      : Option.some<Hat>('None')
  const maybeSkin =
    words.length >= 8
      ? decodeGunSkin(partOfLetter(GunSkin.literals, words[7] ?? ''))
      : Option.some<GunSkin>('Stock')
  const maybeStyle =
    words.length === 9
      ? decodePropStyle(partOfLetter(PropStyle.literals, words[8] ?? ''))
      : Option.some<PropStyle>('Stock')
  return Option.flatMap(lookWithoutHatOfCode(words), look =>
    Option.flatMap(maybeHat, hat =>
      Option.flatMap(maybeSkin, gunSkin =>
        Option.map(maybeStyle, propStyle => ({
          ...look,
          hat,
          gunSkin,
          propStyle,
        })),
      ),
    ),
  )
}
