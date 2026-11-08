import { Schema } from 'effect'
import { defineInMessageUnion } from 'foldkit/message'

import { LookPart } from '../../domain/looks'
import { ProfileTab } from './model'

// NOTE: what the root made of a Look tab pick (src/app/update/profile.ts):
// left as it was, worn, tried on, refused as a gift not reached yet, bought,
// or wanted with too few Bones. The Profile plays it: the try-on, the poof,
// the option's cue.
export const LookOutcome = Schema.Literals([
  'Stay',
  'Wear',
  'Preview',
  'Locked',
  'Bought',
  'Short',
])
export type LookOutcome = typeof LookOutcome.Type

// NOTE: the root's requests. Each generates a ProfileBinding method
// (`RequestedOpen` is `ProfileBinding.requestOpen({ tab, name })`), handled
// in inMessageUpdate.ts. The dice draw from the root's seeded generator, so
// a rolled name comes back in as `InformedOfRolledName`.
export const InMessage = defineInMessageUnion({
  RequestedOpen: { tab: ProfileTab, name: Schema.String },
  RequestedKeepName: {},
  InformedOfRolledName: { name: Schema.String },
  InformedOfLookOutcome: {
    part: LookPart,
    value: Schema.String,
    outcome: LookOutcome,
  },
})
export type InMessage = typeof InMessage.Type
