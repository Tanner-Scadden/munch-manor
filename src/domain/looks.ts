import { Function, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Appearance,
  Body,
  type CosmeticKind,
  GunSkin,
  HairColor,
  HairStyle,
  Hat,
  Outfit,
  Print,
  ShirtColor,
  SkinTone,
} from '../shared/playerData'

// A look's parts, and how a chosen word lands on each: the Profile's Look
// tab picks with them, and the end card dresses a gift a rank up opens.

export const LookPart = Schema.Literals([
  'Body',
  'HairStyle',
  'HairColor',
  'SkinTone',
  'ShirtColor',
  'Outfit',
  'Print',
  'Hat',
  'GunSkin',
])
export type LookPart = typeof LookPart.Type

const readAs =
  <A extends string>(schema: Schema.Codec<A>) =>
  (value: string): Option.Option<A> =>
    Schema.decodeUnknownOption(schema)(value)

// NOTE: how a chosen word lands in the look. A word that is not one of the
// part's options leaves the look as it was.
const CHOICES: Readonly<
  Record<LookPart, (appearance: Appearance, value: string) => Appearance>
> = {
  Body: (appearance, value) =>
    Option.match(readAs(Body)(value), {
      onNone: () => appearance,
      onSome: body => modifyFields(appearance, { body: () => body }),
    }),
  HairStyle: (appearance, value) =>
    Option.match(readAs(HairStyle)(value), {
      onNone: () => appearance,
      onSome: hairStyle =>
        modifyFields(appearance, { hairStyle: () => hairStyle }),
    }),
  HairColor: (appearance, value) =>
    Option.match(readAs(HairColor)(value), {
      onNone: () => appearance,
      onSome: hairColor =>
        modifyFields(appearance, { hairColor: () => hairColor }),
    }),
  SkinTone: (appearance, value) =>
    Option.match(readAs(SkinTone)(value), {
      onNone: () => appearance,
      onSome: skinTone =>
        modifyFields(appearance, { skinTone: () => skinTone }),
    }),
  ShirtColor: (appearance, value) =>
    Option.match(readAs(ShirtColor)(value), {
      onNone: () => appearance,
      onSome: shirtColor =>
        modifyFields(appearance, { shirtColor: () => shirtColor }),
    }),
  Outfit: (appearance, value) =>
    Option.match(readAs(Outfit)(value), {
      onNone: () => appearance,
      onSome: outfit => modifyFields(appearance, { outfit: () => outfit }),
    }),
  Print: (appearance, value) =>
    Option.match(readAs(Print)(value), {
      onNone: () => appearance,
      onSome: print => modifyFields(appearance, { print: () => print }),
    }),
  Hat: (appearance, value) =>
    Option.match(readAs(Hat)(value), {
      onNone: () => appearance,
      onSome: hat => modifyFields(appearance, { hat: () => hat }),
    }),
  GunSkin: (appearance, value) =>
    Option.match(readAs(GunSkin)(value), {
      onNone: () => appearance,
      onSome: gunSkin => modifyFields(appearance, { gunSkin: () => gunSkin }),
    }),
}

// NOTE: the part of the look each kind of earned look sits on.
export const PART_OF_KIND: Readonly<Record<CosmeticKind, LookPart>> = {
  Hat: 'Hat',
  Shirt: 'ShirtColor',
  Print: 'Print',
  Skin: 'GunSkin',
}

export const chooseLook: {
  (part: LookPart, value: string): (appearance: Appearance) => Appearance
  (appearance: Appearance, part: LookPart, value: string): Appearance
} = Function.dual(
  3,
  (appearance: Appearance, part: LookPart, value: string): Appearance =>
    CHOICES[part](appearance, value),
)
