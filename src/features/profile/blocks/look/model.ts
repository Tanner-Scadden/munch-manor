import { Function, Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'

import { LookPart } from '../../../../domain/looks'
import {
  Appearance,
  Calling,
  type CosmeticKind,
  SavedBoughtCosmetics,
  SavedRank,
} from '../../../../shared/playerData'
import { LookSection, type LookToggle } from './lookSchema'

// NOTE: the Look tab's own state: which of its little tabs is showing. Not
// saved, and nothing else reads it: it opens on Body each time the tab is
// drawn. The look itself, and every pick's rules, are the root's.
export const Model = Schema.Struct({ section: LookSection })
export type Model = typeof Model.Type

// NOTE: the last bit of juice the Profile played: a poof for a new look
// part, a slot-machine spin for a dice roll, or nothing. The Profile keeps
// it (src/features/profile/model.ts) and hands it to the Look tab's stage.
export const ProfileFx = Schema.Literals(['Still', 'Poof', 'Spin'])
export type ProfileFx = typeof ProfileFx.Type

// NOTE: the last thing a Look tab option did, for the option to play: a look
// bought (a poof), or wanted with too few Bones or not reached yet (the price
// or the padlock shakes red). The count moves on every time, and the view
// reads only its parity, so the same cue twice in a row still replays.
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

// NOTE: a look for sale being tried on in the Look tab: shown on the
// figure and never worn, saved, or synced until it is bought.
export const LookPreview = Schema.Struct({
  part: LookPart,
  value: Schema.String,
})
export type LookPreview = typeof LookPreview.Type

// NOTE: what the Profile hands the Look tab: the look worn, the hero (the
// figure's gun), the clock (its walk and turn), the Profile's effect and
// its count, what is owned and new (the root's), the look being tried on,
// and the last option's cue.
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
      ? UiStruct.evolve(appearance, { beard: isOn => !isOn })
      : UiStruct.evolve(appearance, { glasses: isOn => !isOn }),
)

export type Gear = Readonly<{
  kind: CosmeticKind
  worn: (appearance: Appearance) => string
}>

// NOTE: the four parts that hold earned looks (src/domain/closet.ts), by the
// kind of look and what each wears now. Their rows pick by a click and not
// by the radio group, so a look not owned is never the selected one. Every
// other part is free and is simply chosen.
const GEAR: Readonly<Partial<Record<LookPart, Gear>>> = {
  ShirtColor: { kind: 'Shirt', worn: appearance => appearance.shirtColor },
  Print: { kind: 'Print', worn: appearance => appearance.print },
  Hat: { kind: 'Hat', worn: appearance => appearance.hat },
  GunSkin: { kind: 'Skin', worn: appearance => appearance.gunSkin },
}

export const gearOf = (part: LookPart): Option.Option<Gear> =>
  Option.fromNullishOr(GEAR[part])
