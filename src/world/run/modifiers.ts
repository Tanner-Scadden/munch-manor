import { Array, Function, Schema } from 'effect'

export const Modifier = Schema.Literals([
  'FriendlyFire',
  'BigCrowd',
  'Broke',
  'Glass',
])
export type Modifier = typeof Modifier.Type

export const MODIFIER_ORDER: Array.NonEmptyReadonlyArray<Modifier> = [
  'FriendlyFire',
  'BigCrowd',
  'Broke',
  'Glass',
]

export const Modifiers = Schema.Struct({
  friendlyFire: Schema.Boolean,
  bigCrowd: Schema.Boolean,
  broke: Schema.Boolean,
  glass: Schema.Boolean,
})
export type Modifiers = typeof Modifiers.Type

export const noModifiers: Modifiers = {
  friendlyFire: false,
  bigCrowd: false,
  broke: false,
  glass: false,
}

const FIELD_OF: Readonly<Record<Modifier, keyof Modifiers>> = {
  FriendlyFire: 'friendlyFire',
  BigCrowd: 'bigCrowd',
  Broke: 'broke',
  Glass: 'glass',
}

export const isModifierOn: {
  (modifier: Modifier): (modifiers: Modifiers) => boolean
  (modifiers: Modifiers, modifier: Modifier): boolean
} = Function.dual(
  2,
  (modifiers: Modifiers, modifier: Modifier): boolean =>
    modifiers[FIELD_OF[modifier]],
)

export const toggledModifier: {
  (modifier: Modifier): (modifiers: Modifiers) => Modifiers
  (modifiers: Modifiers, modifier: Modifier): Modifiers
} = Function.dual(2, (modifiers: Modifiers, modifier: Modifier): Modifiers => ({
  ...modifiers,
  [FIELD_OF[modifier]]: !isModifierOn(modifiers, modifier),
}))

export const modifiersOn = (modifiers: Modifiers): ReadonlyArray<Modifier> =>
  Array.filter(MODIFIER_ORDER, modifier => isModifierOn(modifiers, modifier))

const BONUS_PERCENT: Readonly<Record<Modifier, number>> = {
  FriendlyFire: 15,
  BigCrowd: 25,
  Broke: 75,
  Glass: 350,
}

export const bonusPercentOfModifier = (modifier: Modifier): number =>
  BONUS_PERCENT[modifier]

export const bonusPercentOf = (modifiers: Modifiers): number =>
  Array.reduce(
    modifiersOn(modifiers),
    0,
    (sum, modifier) => sum + BONUS_PERCENT[modifier],
  )

export const maskOfModifiers = (modifiers: Modifiers): number =>
  Array.reduce(MODIFIER_ORDER, 0, (mask, modifier, index) =>
    isModifierOn(modifiers, modifier) ? mask | (1 << index) : mask,
  )

export const modifiersOfMask = (mask: number): Modifiers => ({
  friendlyFire: (mask & 1) !== 0,
  bigCrowd: (mask & 2) !== 0,
  broke: (mask & 4) !== 0,
  glass: (mask & 8) !== 0,
})

const BROKE_KEY_SCALE = 0.5

export const brokeKeyScaleOf = (modifiers: Modifiers): number =>
  modifiers.broke ? BROKE_KEY_SCALE : 1

export const BIG_CROWD_SCALE = 1.5

export const GLASS_START_HEARTS = 1
