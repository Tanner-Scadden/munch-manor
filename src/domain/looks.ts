import { Function, Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'

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

const CHOICES: Readonly<
  Record<LookPart, (appearance: Appearance, value: string) => Appearance>
> = {
  Body: (appearance, value) =>
    Option.match(readAs(Body)(value), {
      onNone: () => appearance,
      onSome: body => UiStruct.evolve(appearance, { body: () => body }),
    }),
  HairStyle: (appearance, value) =>
    Option.match(readAs(HairStyle)(value), {
      onNone: () => appearance,
      onSome: hairStyle =>
        UiStruct.evolve(appearance, { hairStyle: () => hairStyle }),
    }),
  HairColor: (appearance, value) =>
    Option.match(readAs(HairColor)(value), {
      onNone: () => appearance,
      onSome: hairColor =>
        UiStruct.evolve(appearance, { hairColor: () => hairColor }),
    }),
  SkinTone: (appearance, value) =>
    Option.match(readAs(SkinTone)(value), {
      onNone: () => appearance,
      onSome: skinTone =>
        UiStruct.evolve(appearance, { skinTone: () => skinTone }),
    }),
  ShirtColor: (appearance, value) =>
    Option.match(readAs(ShirtColor)(value), {
      onNone: () => appearance,
      onSome: shirtColor =>
        UiStruct.evolve(appearance, { shirtColor: () => shirtColor }),
    }),
  Outfit: (appearance, value) =>
    Option.match(readAs(Outfit)(value), {
      onNone: () => appearance,
      onSome: outfit => UiStruct.evolve(appearance, { outfit: () => outfit }),
    }),
  Print: (appearance, value) =>
    Option.match(readAs(Print)(value), {
      onNone: () => appearance,
      onSome: print => UiStruct.evolve(appearance, { print: () => print }),
    }),
  Hat: (appearance, value) =>
    Option.match(readAs(Hat)(value), {
      onNone: () => appearance,
      onSome: hat => UiStruct.evolve(appearance, { hat: () => hat }),
    }),
  GunSkin: (appearance, value) =>
    Option.match(readAs(GunSkin)(value), {
      onNone: () => appearance,
      onSome: gunSkin =>
        UiStruct.evolve(appearance, { gunSkin: () => gunSkin }),
    }),
}

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
