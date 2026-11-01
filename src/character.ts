import { Option, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import {
  type Appearance,
  Body,
  CharacterPicker,
  HairColor,
  HairStyle,
  LookPart,
  type LookSection,
  LookToggle,
  Outfit,
  Print,
  ShirtColor,
  SkinTone,
} from './model'
import { type CosmeticKind, GunSkin, Hat } from './playerData'

// MESSAGE

export const Message = defineMessageUnion({
  ClickedToggle: { toggle: LookToggle },
  ClickedDiceButton: {},
  // NOTE: the rows of earned looks (shirt color, print, hat, gun skin) pick
  // by this click and not by the radio group, which is read only there: an
  // arrow key only moves focus, so walking a row never buys anything.
  ClickedGearOption: { part: LookPart, value: Schema.String },
})
export type Message = typeof Message.Type

const OutMessage = defineMessageUnion({
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RequestedRandomLook: {},
})
type OutMessage = typeof OutMessage.Type

type PartRadioGroupModel = typeof PartRadioGroupBlock.Model.Type

// LOOK

// NOTE: the parts on each of the Look tab's little tabs, in order.
export const SECTION_PARTS: Readonly<
  Record<LookSection, ReadonlyArray<LookPart>>
> = {
  Body: ['Body', 'SkinTone'],
  Hair: ['HairStyle', 'HairColor'],
  Outfit: ['Outfit', 'ShirtColor', 'Print'],
  Gear: ['Hat', 'GunSkin'],
}

// NOTE: the on and off parts each little tab shows under its rows.
export const SECTION_TOGGLES: Readonly<
  Record<LookSection, ReadonlyArray<LookToggle>>
> = {
  Body: ['Beard', 'Glasses'],
  Hair: [],
  Outfit: [],
  Gear: [],
}

export const isToggleOn = (appearance: Appearance, toggle: LookToggle) =>
  toggle === 'Beard' ? appearance.beard : appearance.glasses

export const flipLook = (
  appearance: Appearance,
  toggle: LookToggle,
): Appearance =>
  toggle === 'Beard'
    ? modifyFields(appearance, { beard: isOn => !isOn })
    : modifyFields(appearance, { glasses: isOn => !isOn })

const readAs =
  <A extends string>(schema: Schema.Codec<A>) =>
  (value: string): Option.Option<A> =>
    Schema.decodeUnknownOption(schema)(value)

type Part = Readonly<{
  read: (picker: CharacterPicker) => PartRadioGroupModel
  choose: (appearance: Appearance, value: string) => Appearance
}>

// NOTE: each part's radio group in the picker, and how a chosen word lands
// in the look. A word that is not one of the part's options leaves the
// look as it was.
const PARTS: Readonly<Record<LookPart, Part>> = {
  Body: {
    read: picker => picker.body,
    choose: (appearance, value) =>
      Option.match(readAs(Body)(value), {
        onNone: () => appearance,
        onSome: body => modifyFields(appearance, { body: () => body }),
      }),
  },
  HairStyle: {
    read: picker => picker.hairStyle,
    choose: (appearance, value) =>
      Option.match(readAs(HairStyle)(value), {
        onNone: () => appearance,
        onSome: hairStyle =>
          modifyFields(appearance, { hairStyle: () => hairStyle }),
      }),
  },
  HairColor: {
    read: picker => picker.hairColor,
    choose: (appearance, value) =>
      Option.match(readAs(HairColor)(value), {
        onNone: () => appearance,
        onSome: hairColor =>
          modifyFields(appearance, { hairColor: () => hairColor }),
      }),
  },
  SkinTone: {
    read: picker => picker.skinTone,
    choose: (appearance, value) =>
      Option.match(readAs(SkinTone)(value), {
        onNone: () => appearance,
        onSome: skinTone =>
          modifyFields(appearance, { skinTone: () => skinTone }),
      }),
  },
  ShirtColor: {
    read: picker => picker.shirtColor,
    choose: (appearance, value) =>
      Option.match(readAs(ShirtColor)(value), {
        onNone: () => appearance,
        onSome: shirtColor =>
          modifyFields(appearance, { shirtColor: () => shirtColor }),
      }),
  },
  Outfit: {
    read: picker => picker.outfit,
    choose: (appearance, value) =>
      Option.match(readAs(Outfit)(value), {
        onNone: () => appearance,
        onSome: outfit => modifyFields(appearance, { outfit: () => outfit }),
      }),
  },
  Print: {
    read: picker => picker.print,
    choose: (appearance, value) =>
      Option.match(readAs(Print)(value), {
        onNone: () => appearance,
        onSome: print => modifyFields(appearance, { print: () => print }),
      }),
  },
  Hat: {
    read: picker => picker.hat,
    choose: (appearance, value) =>
      Option.match(readAs(Hat)(value), {
        onNone: () => appearance,
        onSome: hat => modifyFields(appearance, { hat: () => hat }),
      }),
  },
  GunSkin: {
    read: picker => picker.gunSkin,
    choose: (appearance, value) =>
      Option.match(readAs(GunSkin)(value), {
        onNone: () => appearance,
        onSome: gunSkin => modifyFields(appearance, { gunSkin: () => gunSkin }),
      }),
  },
}

type Gear = Readonly<{
  kind: CosmeticKind
  worn: (appearance: Appearance) => string
}>

// NOTE: the four parts that hold earned looks (src/closet.ts), by the kind
// of look and what each wears now. Their rows pick by a click and not by
// the radio group, so a look not owned is never the selected one. Every
// other part is free and is simply chosen.
const GEAR: Readonly<Partial<Record<LookPart, Gear>>> = {
  ShirtColor: { kind: 'Shirt', worn: appearance => appearance.shirtColor },
  Print: { kind: 'Print', worn: appearance => appearance.print },
  Hat: { kind: 'Hat', worn: appearance => appearance.hat },
  GunSkin: { kind: 'Skin', worn: appearance => appearance.gunSkin },
}

// NOTE: the part of the look each kind of earned look sits on.
export const PART_OF_KIND: Readonly<Record<CosmeticKind, LookPart>> = {
  Hat: 'Hat',
  Shirt: 'ShirtColor',
  Print: 'Print',
  Skin: 'GunSkin',
}

export const gearOf = (part: LookPart): Option.Option<Gear> =>
  Option.fromNullishOr(GEAR[part])

export const partGroupOf = (
  picker: CharacterPicker,
  part: LookPart,
): PartRadioGroupModel => PARTS[part].read(picker)

export const chooseLook = (
  appearance: Appearance,
  part: LookPart,
  value: string,
): Appearance => PARTS[part].choose(appearance, value)

// BLOCK

const CharacterDefinition = Block.makeDefinition('Character', {
  Model: CharacterPicker,
  Message,
  OutMessage,
})

const { makeBinding, makeOutMessageForward, makeOutMessageFold } =
  CharacterDefinition

// NOTE: a little tab's choice changes only which parts show. It plays no
// poof, since the look itself is the same.
export const SectionsBinding = makeBinding(SectionRadioGroupBlock, {
  field: 'sections',
  init: false,
}).withOutMessagePolicy({
  fold: makeOutMessageFold(SectionRadioGroupBlock, {
    Selected: ({ value }) =>
      CharacterDefinition.makeFieldsStep(() => ({ section: () => value })),
  }),
})

// NOTE: a part's choice goes up to the root as ChoseLook, which owns the
// look and plays the poof.
const forwardPart = (part: LookPart) =>
  makeOutMessageForward(PartRadioGroupBlock, {
    Selected: ({ value }) => OutMessage.ChoseLook({ part, value }),
  })

export const BodyBinding = makeBinding(PartRadioGroupBlock, {
  field: 'body',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('Body') })

export const HairStyleBinding = makeBinding(PartRadioGroupBlock, {
  field: 'hairStyle',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('HairStyle') })

export const HairColorBinding = makeBinding(PartRadioGroupBlock, {
  field: 'hairColor',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('HairColor') })

export const SkinToneBinding = makeBinding(PartRadioGroupBlock, {
  field: 'skinTone',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('SkinTone') })

export const ShirtColorBinding = makeBinding(PartRadioGroupBlock, {
  field: 'shirtColor',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('ShirtColor') })

export const OutfitBinding = makeBinding(PartRadioGroupBlock, {
  field: 'outfit',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('Outfit') })

export const PrintBinding = makeBinding(PartRadioGroupBlock, {
  field: 'print',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('Print') })

export const HatBinding = makeBinding(PartRadioGroupBlock, {
  field: 'hat',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('Hat') })

export const GunSkinBinding = makeBinding(PartRadioGroupBlock, {
  field: 'gunSkin',
  init: false,
}).withOutMessagePolicy({ forward: forwardPart('GunSkin') })

export const PART_BINDINGS = {
  Body: BodyBinding,
  HairStyle: HairStyleBinding,
  HairColor: HairColorBinding,
  SkinTone: SkinToneBinding,
  ShirtColor: ShirtColorBinding,
  Outfit: OutfitBinding,
  Print: PrintBinding,
  Hat: HatBinding,
  GunSkin: GunSkinBinding,
} as const

export const CharacterComposition = CharacterDefinition.makeComposition({
  bindings: [
    SectionsBinding,
    BodyBinding,
    HairStyleBinding,
    HairColorBinding,
    SkinToneBinding,
    ShirtColorBinding,
    OutfitBinding,
    PrintBinding,
    HatBinding,
    GunSkinBinding,
  ],
})
export type CharacterViewBuilder = Block.ViewBuilderFor<
  typeof CharacterComposition
>

// UPDATE

export const update = CharacterComposition.makeUpdate({
  ClickedToggle: CharacterDefinition.makeOutMessageStep.fromMessage(
    ({ toggle }) => OutMessage.FlippedLook({ toggle }),
  ),
  ClickedDiceButton: CharacterDefinition.makeOutMessageStep(() =>
    OutMessage.RequestedRandomLook(),
  ),
  ClickedGearOption: CharacterDefinition.makeOutMessageStep.fromMessage(
    ({ part, value }) => OutMessage.ChoseLook({ part, value }),
  ),
})

export const init = CharacterComposition.makeInit(
  (picker: CharacterPicker) => ({ model: picker }),
)
