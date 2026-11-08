import { Function, Option, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import {
  type Appearance,
  Body,
  type Calling,
  type CosmeticKind,
  GunSkin,
  HairColor,
  HairStyle,
  Hat,
  Outfit,
  Print,
  type SavedBoughtCosmetics,
  type SavedRank,
  ShirtColor,
  SkinTone,
} from '../../../../shared/playerData'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { LookPart, type LookSection, LookToggle } from './lookSchema'
import {
  CharacterPicker,
  type ClosetCue,
  type LookPreview,
  type ProfileFx,
} from './model'

// MESSAGE

export const Message = defineMessageUnion({
  ClickedToggle: { toggle: LookToggle },
  ClickedDiceButton: {},
  // NOTE: the rows of earned looks (shirt color, print, hat, gun skin) pick
  // by this click and not by the radio group, which is read only there: an
  // arrow key only moves focus, so walking a row never buys anything.
  ClickedGearOption: { part: LookPart, value: Schema.String },
  // NOTE: the BUY pill by the figure, for the look being tried on.
  ClickedBuyButton: {},
})
export type Message = typeof Message.Type

const OutMessage = defineMessageUnion({
  ChoseLook: { part: LookPart, value: Schema.String },
  FlippedLook: { toggle: LookToggle },
  RolledDice: {},
  ClickedBuy: {},
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

export const isToggleOn: {
  (toggle: LookToggle): (appearance: Appearance) => boolean
  (appearance: Appearance, toggle: LookToggle): boolean
} = Function.dual(2, (appearance: Appearance, toggle: LookToggle): boolean =>
  toggle === 'Beard' ? appearance.beard : appearance.glasses,
)

export const flipLook: {
  (toggle: LookToggle): (appearance: Appearance) => Appearance
  (appearance: Appearance, toggle: LookToggle): Appearance
} = Function.dual(
  2,
  (appearance: Appearance, toggle: LookToggle): Appearance =>
    toggle === 'Beard'
      ? modifyFields(appearance, { beard: isOn => !isOn })
      : modifyFields(appearance, { glasses: isOn => !isOn }),
)

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

export type Gear = Readonly<{
  kind: CosmeticKind
  worn: (appearance: Appearance) => string
}>

// NOTE: the four parts that hold earned looks (src/features/profile/blocks/look/closet.ts), by the kind
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

export const partGroupOf: {
  (part: LookPart): (picker: CharacterPicker) => PartRadioGroupModel
  (picker: CharacterPicker, part: LookPart): PartRadioGroupModel
} = Function.dual(
  2,
  (picker: CharacterPicker, part: LookPart): PartRadioGroupModel =>
    PARTS[part].read(picker),
)

export const chooseLook: {
  (part: LookPart, value: string): (appearance: Appearance) => Appearance
  (appearance: Appearance, part: LookPart, value: string): Appearance
} = Function.dual(
  3,
  (appearance: Appearance, part: LookPart, value: string): Appearance =>
    PARTS[part].choose(appearance, value),
)

// BLOCK

// NOTE: what the Profile hands the Look tab's view each frame: the look
// worn, what is owned and new (the root's, passed down), and the Profile's
// effects.
export type ViewInputs = Readonly<{
  appearance: Appearance
  calling: Calling
  screenMs: number
  fx: ProfileFx
  fxCount: number
  bought: SavedBoughtCosmetics
  rank: SavedRank
  fresh: ReadonlyArray<string>
  maybePreview: Option.Option<LookPreview>
  cue: ClosetCue
}>

const CharacterKey = Symbol('Character')
export const CharacterBlock = Block.make('Character', {
  key: CharacterKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model: CharacterPicker,
  Message,
  OutMessage,
})

const {
  makeFieldsStep,
  makeOutMessageFold,
  makeOutMessageForward,
  makeOutMessageStep,
  makeRequiredFieldBinding,
} = CharacterBlock

// NOTE: a little tab's choice changes only which parts show. It plays no
// poof, since the look itself is the same.
export const SectionsBinding = makeRequiredFieldBinding(
  SectionRadioGroupBlock,
  {
    field: 'sections',
    init: { contextToArgs: () => [{ id: 'look-sections' }] },
  },
).withOutMessagePolicy({
  fold: makeOutMessageFold(SectionRadioGroupBlock, {
    Selected: ({ value }) => makeFieldsStep(() => ({ section: () => value })),
  }),
})

// NOTE: a part's choice goes up as ChoseLook, to the Profile and on to the
// root, which owns the look and plays the poof.
const forwardPart = (part: LookPart) =>
  makeOutMessageForward(PartRadioGroupBlock, {
    Selected: ({ value }) => OutMessage.ChoseLook({ part, value }),
  })

export const BodyBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'body',
  init: { contextToArgs: () => [{ id: 'look-body' }] },
}).withOutMessagePolicy({ forward: forwardPart('Body') })

export const HairStyleBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'hairStyle',
  init: { contextToArgs: () => [{ id: 'look-hair-style' }] },
}).withOutMessagePolicy({ forward: forwardPart('HairStyle') })

export const HairColorBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'hairColor',
  init: { contextToArgs: () => [{ id: 'look-hair-color' }] },
}).withOutMessagePolicy({ forward: forwardPart('HairColor') })

export const SkinToneBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'skinTone',
  init: { contextToArgs: () => [{ id: 'look-skin-tone' }] },
}).withOutMessagePolicy({ forward: forwardPart('SkinTone') })

export const ShirtColorBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'shirtColor',
  init: { contextToArgs: () => [{ id: 'look-shirt-color' }] },
}).withOutMessagePolicy({ forward: forwardPart('ShirtColor') })

export const OutfitBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'outfit',
  init: { contextToArgs: () => [{ id: 'look-outfit' }] },
}).withOutMessagePolicy({ forward: forwardPart('Outfit') })

export const PrintBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'print',
  init: { contextToArgs: () => [{ id: 'look-print' }] },
}).withOutMessagePolicy({ forward: forwardPart('Print') })

export const HatBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'hat',
  init: { contextToArgs: () => [{ id: 'look-hat' }] },
}).withOutMessagePolicy({ forward: forwardPart('Hat') })

export const GunSkinBinding = makeRequiredFieldBinding(PartRadioGroupBlock, {
  field: 'gunSkin',
  init: { contextToArgs: () => [{ id: 'look-gun-skin' }] },
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

export const CharacterComposition = CharacterBlock.makeComposition({
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
  ClickedToggle: makeOutMessageStep.fromMessage(({ toggle }) =>
    OutMessage.FlippedLook({ toggle }),
  ),
  ClickedDiceButton: makeOutMessageStep(() => OutMessage.RolledDice()),
  ClickedBuyButton: makeOutMessageStep(() => OutMessage.ClickedBuy()),
  ClickedGearOption: makeOutMessageStep.fromMessage(({ part, value }) =>
    OutMessage.ChoseLook({ part, value }),
  ),
})

// NOTE: the Look tab starts on Body, and each radio group starts from its
// own init through its Binding.
export const init = CharacterComposition.makeInit(() => ({
  model: { section: 'Body' },
}))
