import { Function, Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'

import { LookPart } from '#domain/looks.ts'
import {
  Appearance,
  Calling,
  type CosmeticKind,
  SavedBoughtCosmetics,
  SavedRank,
} from '#shared/records/playerData.ts'

import { LookSection, type LookToggle } from './lookSchema.ts'

export const Model = Schema.Struct({ section: LookSection })
export type Model = typeof Model.Type

export const ProfileFx = Schema.Literals(['Still', 'Poof', 'Spin'])
export type ProfileFx = typeof ProfileFx.Type

export const ClosetCueKind = Schema.Literals([
  'Still',
  'Bought',
  'Worn',
  'Short',
])
export type ClosetCueKind = typeof ClosetCueKind.Type

export const ClosetCue = Schema.Struct({
  part: LookPart,
  value: Schema.String,
  kind: ClosetCueKind,
  count: Schema.Finite,
})
export type ClosetCue = typeof ClosetCue.Type

export const LookPreview = Schema.Struct({
  part: LookPart,
  value: Schema.String,
})
export type LookPreview = typeof LookPreview.Type

export const CharacterProps = Schema.Struct({
  appearance: Appearance,
  calling: Calling,
  screenMs: Schema.Finite,
  fx: ProfileFx,
  fxCount: Schema.Finite,
  bought: SavedBoughtCosmetics,
  rank: SavedRank,
  fresh: Schema.Array(Schema.String),
  maybePreview: Schema.Option(LookPreview),
  cue: ClosetCue,
})
export type CharacterProps = typeof CharacterProps.Type

export const SECTION_PARTS: Readonly<
  Record<LookSection, ReadonlyArray<LookPart>>
> = {
  Body: ['Body', 'SkinTone'],
  Hair: ['HairStyle', 'HairColor'],
  Outfit: ['Outfit', 'ShirtColor', 'Print'],
  Gear: ['Hat', 'GunSkin'],
}

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
      ? UiStruct.evolve(appearance, { beard: isOn => !isOn })
      : UiStruct.evolve(appearance, { glasses: isOn => !isOn }),
)

export type Gear = Readonly<{
  kind: CosmeticKind
  worn: (appearance: Appearance) => string
}>

const GEAR: Readonly<Partial<Record<LookPart, Gear>>> = {
  ShirtColor: { kind: 'Shirt', worn: appearance => appearance.shirtColor },
  Print: { kind: 'Print', worn: appearance => appearance.print },
  Hat: { kind: 'Hat', worn: appearance => appearance.hat },
  GunSkin: { kind: 'Skin', worn: appearance => appearance.gunSkin },
}

export const gearOf = (part: LookPart): Option.Option<Gear> =>
  Option.fromNullishOr(GEAR[part])
