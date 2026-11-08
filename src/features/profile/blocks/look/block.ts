import { Function, Option, Schema } from 'effect'
import { Block } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { LookPart } from '../../../../domain/looks'
import type {
  Appearance,
  Calling,
  CosmeticKind,
  SavedBoughtCosmetics,
  SavedRank,
} from '../../../../shared/playerData'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { type LookSection, LookToggle } from './lookSchema'
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

// NOTE: each part's radio group in the picker.
const PART_GROUPS: Readonly<
  Record<LookPart, (picker: CharacterPicker) => PartRadioGroupModel>
> = {
  Body: picker => picker.body,
  HairStyle: picker => picker.hairStyle,
  HairColor: picker => picker.hairColor,
  SkinTone: picker => picker.skinTone,
  ShirtColor: picker => picker.shirtColor,
  Outfit: picker => picker.outfit,
  Print: picker => picker.print,
  Hat: picker => picker.hat,
  GunSkin: picker => picker.gunSkin,
}

export type Gear = Readonly<{
  kind: CosmeticKind
  worn: (appearance: Appearance) => string
}>

// NOTE: the four parts that hold earned looks (src/domain/closet.ts), by the kind
// of look and what each wears now. Their rows pick by a click and not by
// the radio group, so a look not owned is never the selected one. Every
// other part is free and is simply chosen.
const GEAR: Readonly<Partial<Record<LookPart, Gear>>> = {
  ShirtColor: { kind: 'Shirt', worn: appearance => appearance.shirtColor },
  Print: { kind: 'Print', worn: appearance => appearance.print },
  Hat: { kind: 'Hat', worn: appearance => appearance.hat },
  GunSkin: { kind: 'Skin', worn: appearance => appearance.gunSkin },
}

export const gearOf = (part: LookPart): Option.Option<Gear> =>
  Option.fromNullishOr(GEAR[part])

export const partGroupOf: {
  (part: LookPart): (picker: CharacterPicker) => PartRadioGroupModel
  (picker: CharacterPicker, part: LookPart): PartRadioGroupModel
} = Function.dual(
  2,
  (picker: CharacterPicker, part: LookPart): PartRadioGroupModel =>
    PART_GROUPS[part](picker),
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
