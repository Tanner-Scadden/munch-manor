import { Effect, Option, Schema, SchemaGetter } from 'effect'

// NOTE: the player's lasting data as Schemas, shared with the sync Worker in
// infra/worker, which bundles it against its own, newer Effect. It imports
// nothing but `effect` and uses only Schema APIs both versions have, so the
// Worker never pulls in the game. src/model.ts and src/save.ts re-export
// these.

// SETTINGS

export const SoundSetting = Schema.Literals(['On', 'Muted'])
export type SoundSetting = typeof SoundSetting.Type

export const MusicSetting = Schema.Literals(['On', 'Off'])
export type MusicSetting = typeof MusicSetting.Type

export const HomeScreenTip = Schema.Literals(['Unseen', 'Dismissed'])
export type HomeScreenTip = typeof HomeScreenTip.Type

export const ShakeSetting = Schema.Literals(['On', 'Off'])
export type ShakeSetting = typeof ShakeSetting.Type

// NOTE: the pointer over the game: the thin system crosshair, or a bold
// drawn one that stands out on the dark floor.
export const CursorSetting = Schema.Literals(['Thin', 'Bold'])
export type CursorSetting = typeof CursorSetting.Type

// NOTE: whether the game sends an anonymous run summary at the end of each
// run (src/analytics.ts). On by default, kept in the player's save.
export const ShareStatsSetting = Schema.Literals(['On', 'Off'])
export type ShareStatsSetting = typeof ShareStatsSetting.Type

// NOTE: how an installed phone app turns. Landscape locks it sideways, the
// default for everyone; Auto lets it follow the phone into portrait.
export const RotationSetting = Schema.Literals(['Landscape', 'Auto'])
export type RotationSetting = typeof RotationSetting.Type

// NOTE: a calling (GAME_DESIGN.md, "Rank and Bones"): what a player brings
// to a run. YOU is the default and has no quirk; the others unlock by rank
// (src/calling.ts). It lives here, with the save's other Schemas, because
// the save keeps the one picked and the World keeps each player's.
export const Calling = Schema.Literals([
  'You',
  'Handyman',
  'TrackStar',
  'PennyPincher',
  'LineCook',
])
export type Calling = typeof Calling.Type

// NOTE: a calling as the co-op lobby carries it, as text: the calling it
// names, or nothing when it names none of ours.
export const callingOfCode = (code: string): Option.Option<Calling> =>
  Schema.decodeUnknownOption(Calling)(code)

export const Difficulty = Schema.Literals([
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
])
export type Difficulty = typeof Difficulty.Type

// LOOK

// NOTE: decided with the owner on 2026-10-30: a simple look built from
// parts, none tied to another. A body is a shape, never a sex, and every
// hair style, beard, glasses, outfit, and print works on every body. See
// "Character" in GAME_DESIGN.md. Each list only grows at its end: the look
// code (lookCodeOf) carries the newer parts by their place in it.

export const Body = Schema.Literals(['Slim', 'Broad'])
export type Body = typeof Body.Type

export const HairStyle = Schema.Literals([
  'Short',
  'Long',
  'Ponytail',
  'Curly',
  'Mohawk',
  'Bald',
])
export type HairStyle = typeof HairStyle.Type

export const HairColor = Schema.Literals([
  'Black',
  'Brown',
  'Blonde',
  'Red',
  'Grey',
  'Pink',
])
export type HairColor = typeof HairColor.Type

// NOTE: lightest to deepest, evenly spaced in lightness (see SKIN_SHADES in
// src/appearance.ts).
export const SkinTone = Schema.Literals([
  'Fair',
  'Light',
  'Medium',
  'Tan',
  'Brown',
  'Deep',
])
export type SkinTone = typeof SkinTone.Type

// NOTE: the six shirt colors every player has. The earned ones follow the
// hats' (see COSMETIC_GIFT_RANKS); each list only grows at its end, as the
// look code carries a print by its place.
export const FreeShirtColor = Schema.Literals([
  'Blue',
  'Red',
  'Yellow',
  'Teal',
  'Pink',
  'Purple',
])
export type FreeShirtColor = typeof FreeShirtColor.Type

export const GiftShirtColor = Schema.Literals(['Gold', 'Glow'])
export type GiftShirtColor = typeof GiftShirtColor.Type

const SoldShirtColor = Schema.Literals(['Midnight', 'Coral'])
type SoldShirtColor = typeof SoldShirtColor.Type

export const ShirtColor = Schema.Literals([
  ...FreeShirtColor.literals,
  ...GiftShirtColor.literals,
  ...SoldShirtColor.literals,
])
export type ShirtColor = typeof ShirtColor.Type

export const Outfit = Schema.Literals(['Tee', 'Hoodie', 'Dress', 'Overalls'])
export type Outfit = typeof Outfit.Type

export const FreePrint = Schema.Literals(['Plain', 'Stripes', 'Rainbow'])
export type FreePrint = typeof FreePrint.Type

export const GiftPrint = Schema.Literals(['Polka', 'Checker'])
export type GiftPrint = typeof GiftPrint.Type

const SoldPrint = Schema.Literals(['Skull', 'Flames'])
type SoldPrint = typeof SoldPrint.Type

export const Print = Schema.Literals([
  ...FreePrint.literals,
  ...GiftPrint.literals,
  ...SoldPrint.literals,
])
export type Print = typeof Print.Type

// NOTE: gun skins: a palette swap of the guns the player holds. Stock is the
// guns as they always were.
export const GiftGunSkin = Schema.Literals(['Gold', 'Slime'])
export type GiftGunSkin = typeof GiftGunSkin.Type

const SoldGunSkin = Schema.Literals(['Candy', 'Bone', 'Neon'])
type SoldGunSkin = typeof SoldGunSkin.Type

export const GunSkin = Schema.Literals([
  'Stock',
  ...GiftGunSkin.literals,
  ...SoldGunSkin.literals,
])
export type GunSkin = typeof GunSkin.Type

// NOTE: hats (GAME_DESIGN.md, "Rank and Bones"): the closet's stock. A gift
// hat is free once the player's rank reaches its rank; a sold hat costs
// Bones, once. Each list only grows at its end: the look code carries the
// hat by its place in `Hat`. The catalog lives here, with the Schemas, so
// the player scope can read a price when it applies a purchase.
export const GiftHat = Schema.Literals([
  'PartyHat',
  'BucketHat',
  'PomBeanie',
  'PropellerCap',
  'CowboyHat',
  'HornedHelmet',
  'TopHat',
  'PirateHat',
  'WitchHat',
  'TrafficCone',
])
export type GiftHat = typeof GiftHat.Type

export const SoldHat = Schema.Literals([
  'Colander',
  'Fez',
  'BunnyEars',
  'Plunger',
  'Lampshade',
  'PumpkinHead',
])
export type SoldHat = typeof SoldHat.Type

export const Hat = Schema.Literals([
  'None',
  ...GiftHat.literals,
  ...SoldHat.literals,
])
export type Hat = typeof Hat.Type

// NOTE: the rank a gift hat is free at. They sit between the callings'
// ranks (3, 6, 10, and 15).
const HAT_GIFT_RANKS: Readonly<Record<GiftHat, number>> = {
  PartyHat: 2,
  BucketHat: 4,
  PomBeanie: 5,
  PropellerCap: 7,
  CowboyHat: 8,
  HornedHelmet: 9,
  TopHat: 11,
  PirateHat: 12,
  WitchHat: 13,
  TrafficCone: 14,
}

const HAT_PRICES: Readonly<Record<SoldHat, number>> = {
  Colander: 40,
  Fez: 50,
  BunnyEars: 50,
  Plunger: 60,
  Lampshade: 70,
  PumpkinHead: 80,
}

// NOTE: the closet's catalog of everything earned, by cosmetic id. A hat's id
// is its name, as bought rows have always held it; the others carry their
// kind (`shirt:Gold`, `print:Polka`, `skin:Gold`). An id with a rank is a
// gift; an id with a price is sold; an id with neither is free. The player
// scope reads the price of any kind from here when it applies a purchase.
export const CosmeticKind = Schema.Literals(['Hat', 'Shirt', 'Print', 'Skin'])
export type CosmeticKind = typeof CosmeticKind.Type

const KIND_PREFIXES: Readonly<Record<CosmeticKind, string>> = {
  Hat: '',
  Shirt: 'shirt:',
  Print: 'print:',
  Skin: 'skin:',
}

export const cosmeticIdOf = (kind: CosmeticKind, name: string): string =>
  `${KIND_PREFIXES[kind]}${name}`

const idsOf = (
  kind: CosmeticKind,
  names: ReadonlyArray<string>,
  value: number,
): Readonly<Record<string, number>> =>
  Object.fromEntries(names.map(name => [cosmeticIdOf(kind, name), value]))

const SHIRT_PRICE = 20
const PRINT_PRICE = 20
const SKIN_PRICE = 60

// NOTE: a hero is bought with Bones and kept in the same list of ids as the
// looks (GAME_DESIGN.md, "Rank and Bones"): `hero:Handyman`. YOU is free
// and has no id. A hero opens for sale at its rank (UNLOCK_RANKS in
// src/calling.ts) and costs this once bought.
export const heroIdOf = (calling: string): string => `hero:${calling}`

const HERO_PRICES: Readonly<Record<string, number>> = {
  [heroIdOf('Handyman')]: 60,
  [heroIdOf('TrackStar')]: 100,
  [heroIdOf('PennyPincher')]: 150,
  [heroIdOf('LineCook')]: 200,
}

export const COSMETIC_PRICES: Readonly<Record<string, number>> = {
  ...HAT_PRICES,
  ...HERO_PRICES,
  ...idsOf('Shirt', SoldShirtColor.literals, SHIRT_PRICE),
  ...idsOf('Print', SoldPrint.literals, PRINT_PRICE),
  ...idsOf('Skin', SoldGunSkin.literals, SKIN_PRICE),
}

// NOTE: the earned looks' gift ranks continue after the hats', between the
// callings' (3, 6, 10, and 15).
export const COSMETIC_GIFT_RANKS: Readonly<Record<string, number>> = {
  ...HAT_GIFT_RANKS,
  'shirt:Gold': 16,
  'print:Polka': 17,
  'skin:Gold': 18,
  'shirt:Glow': 19,
  'print:Checker': 20,
  'skin:Slime': 22,
}

// NOTE: the look before hats (save versions 11 to 14, ChangedAppearance
// version 3, six word co-op codes with four letters). It reads as the same
// look bare headed.
export const PreHatAppearance = Schema.Struct({
  body: Body,
  hairStyle: HairStyle,
  hairColor: HairColor,
  skinTone: SkinTone,
  shirtColor: ShirtColor,
  outfit: Outfit,
  print: Print,
  beard: Schema.Boolean,
  glasses: Schema.Boolean,
})
type PreHatAppearance = typeof PreHatAppearance.Type

// NOTE: the look with a hat and no gun skin (save version 15,
// ChangedAppearance version 4, seven word co-op codes). It reads as the
// same look with the stock guns.
export const PreSkinAppearance = Schema.Struct({
  ...PreHatAppearance.fields,
  hat: Hat,
})
export type PreSkinAppearance = typeof PreSkinAppearance.Type

// NOTE: plain data on purpose: the player scope stores it whole, through
// the ChangedAppearance mutation in src/playerScope.ts.
export const Appearance = Schema.Struct({
  ...PreSkinAppearance.fields,
  gunSkin: GunSkin,
})
export type Appearance = typeof Appearance.Type

// OLDER LOOKS

const oneOf = <A extends string>(
  options: ReadonlyArray<A>,
  value: string,
  fallback: A,
): A => options.find(option => option === value) ?? fallback

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
})

const legacyOfAppearance = (look: Appearance): LegacyAppearance => ({
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
})

const manyPartsOfAppearance = (look: Appearance): ManyPartAppearance => ({
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
const preHatOfAppearance = (look: Appearance): PreHatAppearance => ({
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
    })),
    encode: SchemaGetter.transform(preHatOfAppearance),
  }),
)

const preSkinOfAppearance = (look: Appearance): PreSkinAppearance => ({
  ...preHatOfAppearance(look),
  hat: look.hat,
})

const PreSkinToAppearance = PreSkinAppearance.pipe(
  Schema.decodeTo(Appearance, {
    decode: SchemaGetter.transform((look: PreSkinAppearance): Appearance => ({
      ...look,
      gunSkin: 'Stock',
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
// not Stock (the seventh is then the hat's, A for none). That keeps it
// inside the lobby's eight words and 64 characters. Older codes,
// five words from the first look or six with five letters from the
// many-part look, read as their closest current look. Anything else is
// none.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

const letterOf = (options: ReadonlyArray<string>, value: string): string =>
  LETTERS.charAt(Math.max(0, options.indexOf(value)))

const partOfLetter = (
  options: ReadonlyArray<string>,
  letter: string,
): string | undefined => {
  const index = letter.length === 1 ? LETTERS.indexOf(letter) : -1
  return index < 0 ? undefined : options[index]
}

const FLAG = ['A', 'B'] as const

const flagOfLetter = (letter: string): boolean | undefined =>
  letter === 'A' ? false : letter === 'B' ? true : undefined

export const lookCodeOf = (look: Appearance): string => {
  const letters = [
    letterOf(Outfit.literals, look.outfit),
    letterOf(Print.literals, look.print),
    look.beard ? FLAG[1] : FLAG[0],
    look.glasses ? FLAG[1] : FLAG[0],
  ].join('')
  const code = `${look.body}.${look.hairStyle}.${look.hairColor}.${look.skinTone}.${look.shirtColor}.${letters}`
  const withHat = `${code}.${letterOf(Hat.literals, look.hat)}`
  return look.gunSkin === 'Stock'
    ? look.hat === 'None'
      ? code
      : withHat
    : `${withHat}.${letterOf(GunSkin.literals, look.gunSkin)}`
}

const decodeAppearance = Schema.decodeUnknownOption(Appearance)
const decodeHat = Schema.decodeUnknownOption(Hat)
const decodeGunSkin = Schema.decodeUnknownOption(GunSkin)
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
  const letters = (words[5] ?? '').split('')
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
        outfit: partOfLetter(Outfit.literals, letters[0] ?? ''),
        print: partOfLetter(Print.literals, letters[1] ?? ''),
        beard: flagOfLetter(letters[2] ?? ''),
        glasses: flagOfLetter(letters[3] ?? ''),
        hat: 'None',
        gunSkin: 'Stock',
      })
    : Option.none()
}

export const lookOfCode = (code: string): Option.Option<Appearance> => {
  const words = code.split('.')
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
  if (words.length < 6 || words.length > 8) {
    return Option.none()
  }
  const maybeHat =
    words.length >= 7
      ? decodeHat(partOfLetter(Hat.literals, words[6] ?? ''))
      : Option.some<Hat>('None')
  const maybeSkin =
    words.length === 8
      ? decodeGunSkin(partOfLetter(GunSkin.literals, words[7] ?? ''))
      : Option.some<GunSkin>('Stock')
  return Option.flatMap(lookWithoutHatOfCode(words), look =>
    Option.flatMap(maybeHat, hat =>
      Option.map(maybeSkin, gunSkin => ({ ...look, hat, gunSkin })),
    ),
  )
}

// SAVED

export const SAVE_VERSION = 16

export const SavedLesson = Schema.Literals(['Pending', 'Learned'])
export type SavedLesson = typeof SavedLesson.Type

export const SavedLessons = Schema.Struct({
  move: SavedLesson,
  fire: SavedLesson,
  startWave: SavedLesson,
  shop: SavedLesson,
  swap: SavedLesson,
  pickup: SavedLesson,
  timedBreaks: SavedLesson,
  openBreak: SavedLesson,
})
export type SavedLessons = typeof SavedLessons.Type

export const SavedTrapHint = Schema.Literals(['Unseen', 'Seen'])
export type SavedTrapHint = typeof SavedTrapHint.Type

// NOTE: ammoTip came after save version 11 as a key that reads as Unseen
// when missing, so every older save, an older build's copy of this one, and
// an older device's synced onboarding all still read, with no new version.
export const SavedOnboarding = Schema.Struct({
  lessons: SavedLessons,
  trapHint: SavedTrapHint,
  ammoTip: SavedTrapHint.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed('Unseen')),
  ),
  introducedKinds: Schema.Array(Schema.String),
})
export type SavedOnboarding = typeof SavedOnboarding.Type

// NOTE: version 5 added shareStats, the "Share anonymous play stats" toggle,
// and version 7 added cursor, the "Big cursor" toggle.
export const SavedSettings = Schema.Struct({
  sound: SoundSetting,
  music: MusicSetting,
  shake: ShakeSetting,
  shareStats: ShareStatsSetting,
  cursor: CursorSetting,
})
export type SavedSettings = typeof SavedSettings.Type

export const SavedCard = Schema.Literals(['Unseen', 'Seen'])
export type SavedCard = typeof SavedCard.Type

export const SavedNightmare = Schema.Literals(['Locked', 'Unlocked'])
export type SavedNightmare = typeof SavedNightmare.Type

// NOTE: version 2 added the difficulty: the chosen level, whether the
// first-time card was answered, and the Nightmare unlock.
export const SavedDifficulty = Schema.Struct({
  chosen: Difficulty,
  card: SavedCard,
  nightmare: SavedNightmare,
})
export type SavedDifficulty = typeof SavedDifficulty.Type

// NOTE: version 3 added the bests: runs played, zombies splatted in all and
// per kind, and the fastest win and best endless wave for each difficulty.
// Kills per kind are keyed by kind id, ready for the Munchopedia. A win or a
// wave not reached yet is null.
export const SavedDifficultyBests = Schema.Struct({
  fastestWinMs: Schema.NullOr(Schema.Number),
  bestEndlessWave: Schema.NullOr(Schema.Number),
})
export type SavedDifficultyBests = typeof SavedDifficultyBests.Type

export const SavedBestsByDifficulty = Schema.Struct({
  Easy: SavedDifficultyBests,
  Normal: SavedDifficultyBests,
  Hard: SavedDifficultyBests,
  Nightmare: SavedDifficultyBests,
})
export type SavedBestsByDifficulty = typeof SavedBestsByDifficulty.Type

export const SavedBests = Schema.Struct({
  runsPlayed: Schema.Number,
  totalKills: Schema.Number,
  killsByKind: Schema.Record(Schema.String, Schema.Number),
  byDifficulty: SavedBestsByDifficulty,
})
export type SavedBests = typeof SavedBests.Type

// NOTE: version 12 added a run's records for each difficulty: the furthest
// campaign wave reached and the most zombies splatted in one run, for the
// end card's NEW BEST. A record not set yet is null. Two devices merge them
// to the larger (src/playerScope.ts).
export const SavedRunRecord = Schema.Struct({
  furthestWave: Schema.NullOr(Schema.Number),
  mostKills: Schema.NullOr(Schema.Number),
})
export type SavedRunRecord = typeof SavedRunRecord.Type

export const SavedRunRecords = Schema.Struct({
  Easy: SavedRunRecord,
  Normal: SavedRunRecord,
  Hard: SavedRunRecord,
  Nightmare: SavedRunRecord,
})
export type SavedRunRecords = typeof SavedRunRecords.Type

const noSavedRunRecord: SavedRunRecord = { furthestWave: null, mostKills: null }

export const noSavedRunRecords: SavedRunRecords = {
  Easy: noSavedRunRecord,
  Normal: noSavedRunRecord,
  Hard: noSavedRunRecord,
  Nightmare: noSavedRunRecord,
}

// NOTE: version 13 added rank (src/rank.ts): the points and Bones earned,
// which only ever add, so runs on two linked devices both count; the
// veteran grant for a player from before rank, whether it has been made and
// what it was, merged as the larger so it happens once; and the Bones
// spent, for the closet that is not built yet.
export const SavedRank = Schema.Struct({
  earnedPoints: Schema.Number,
  earnedBones: Schema.Number,
  veteranPoints: Schema.Number,
  veteranBones: Schema.Number,
  isVeteranGranted: Schema.Boolean,
  spentBones: Schema.Number,
})
export type SavedRank = typeof SavedRank.Type

// NOTE: version 15 added the closet: the sold hats the player has bought.
// Version 16 added the shirt colors, prints, and gun skins, so the list now
// holds cosmetic ids (COSMETIC_PRICES): the hats as before, the rest with
// their kind. Bones spent live in SavedRank. What is worn is on the look; a
// gift is owned by rank and never stored here. Kept as a set, merged as a
// union across linked devices.
export const SavedBoughtCosmetics = Schema.Array(Schema.String)
export type SavedBoughtCosmetics = typeof SavedBoughtCosmetics.Type

// NOTE: version 16 added the unlocks the player has seen, by id (`hat:Fez`,
// `shirt:Gold`, `skin:Slime`, `calling:Handyman`; src/unlocks.ts). An unlock
// reached and not in here wears a NEW badge until the player opens the Look
// tab or the character picker. Kept as a set, merged as a union across
// linked devices, like the power-ups seen.
export const SavedSeenUnlocks = Schema.Array(Schema.String)
export type SavedSeenUnlocks = typeof SavedSeenUnlocks.Type

// NOTE: a player row from before NEW badges holds only this mark. It stands
// for every unlock reached the first time the row is loaded, so a player who
// had earned a dozen gifts before NEW badges shipped does not meet a wall of
// them. The first load writes those ids in its place (SawUnlocks in
// src/playerScope.ts drops the mark).
export const SEEN_BASELINE = '*'

// NOTE: version 4 added the home menu: the newest What's New day seen, by
// its date, and the Munchopedia entries opened, by kind id.
export const SavedHome = Schema.Struct({
  seenNewsDay: Schema.NullOr(Schema.String),
  openedEntries: Schema.Array(Schema.String),
})
export type SavedHome = typeof SavedHome.Type

// NOTE: version 6 added the power-up kinds the player has grabbed, by kind
// id. The first grab of a kind explains it, and later grabs only name it.
// Kept apart from the onboarding, since linked devices merge it as a union.
export const SavedPowerUps = Schema.Array(Schema.String)
export type SavedPowerUps = typeof SavedPowerUps.Type

// NOTE: a display name: up to 12 characters, not unique, shown in co-op
// lobbies and above teammates. Kept cleaned (see cleanName in
// src/profile.ts); empty means the player has not picked one.
export const PlayerName = Schema.String.check(Schema.isMaxLength(64))
export type PlayerName = typeof PlayerName.Type

// NOTE: version 8 added the rotation, kept apart from the other settings so
// it syncs as its own last-write-wins change. Version 9 added the display
// name, synced the same way. Version 10 is the many-part look, and version
// 11 the simpler look the owner chose (LOOK above). Version 14 added the
// calling picked for the next run, synced the same way. Version 15 added
// the hat on the look and the hats bought. Version 16 added the gun skin on
// the look and renamed the hats bought to the cosmetics bought.
export const PlayerSave = Schema.Struct({
  version: Schema.Literal(SAVE_VERSION),
  onboarding: SavedOnboarding,
  homeScreenTip: HomeScreenTip,
  settings: SavedSettings,
  appearance: Appearance,
  difficulty: SavedDifficulty,
  bests: SavedBests,
  home: SavedHome,
  seenPowerUps: SavedPowerUps,
  rotation: RotationSetting,
  name: PlayerName,
  records: SavedRunRecords,
  rank: SavedRank,
  calling: Calling,
  boughtCosmetics: SavedBoughtCosmetics,
  seenUnlocks: SavedSeenUnlocks,
})
export type PlayerSave = typeof PlayerSave.Type
