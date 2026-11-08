import { Schema } from 'effect'

import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { LookPart, LookSection } from './lookSchema'

// NOTE: the Look tab: which of its little tabs is showing, and a radio
// group per part. Not saved: it opens on Body each time.
export const CharacterPicker = Schema.Struct({
  section: LookSection,
  sections: SectionRadioGroupBlock.Model,
  body: PartRadioGroupBlock.Model,
  hairStyle: PartRadioGroupBlock.Model,
  hairColor: PartRadioGroupBlock.Model,
  skinTone: PartRadioGroupBlock.Model,
  shirtColor: PartRadioGroupBlock.Model,
  outfit: PartRadioGroupBlock.Model,
  print: PartRadioGroupBlock.Model,
  hat: PartRadioGroupBlock.Model,
  gunSkin: PartRadioGroupBlock.Model,
})
export type CharacterPicker = typeof CharacterPicker.Type

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
