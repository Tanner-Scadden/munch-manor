import { type Array, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import {
  MillisNumber,
  Point,
  PositionNumber,
} from '#world/schema/wireNumber.ts'

export const DareKind = Schema.Literals([
  'SilverSpoon',
  'FamilyPortrait',
  'GuestBookPage',
  'GrandmasRecipe',
  'MusicBox',
  'ButlersBell',
  'NapkinRing',
  'DareNote',
  'FalseTeeth',
  'Invitation',
])
export type DareKind = typeof DareKind.Type

export const HOUSE_THINGS: Array.NonEmptyReadonlyArray<DareKind> = [
  'SilverSpoon',
  'FamilyPortrait',
  'GuestBookPage',
  'GrandmasRecipe',
  'MusicBox',
  'ButlersBell',
]

export const DareThingState = UiSchema.TaggedEnum({
  Hidden: { x: PositionNumber, y: PositionNumber, workedMs: MillisNumber },
  Found: { slot: Schema.Finite },
})
export type DareThingState = typeof DareThingState.Type

export const DareThing = Schema.Struct({
  id: Schema.Finite,
  kind: DareKind,
  state: DareThingState,
})
export type DareThing = typeof DareThing.Type

export const Finale = UiSchema.TaggedEnum({
  Hunting: {},
  Summoned: {},
  KeyFlying: {
    from: Point,
    remainingMs: MillisNumber,
    durationMs: MillisNumber,
  },
  Open: {},
})
export type Finale = typeof Finale.Type

export const Dare = Schema.Struct({
  rngState: Schema.Finite,
  list: Schema.Array(DareKind),
  finale: Finale,
})
export type Dare = typeof Dare.Type
