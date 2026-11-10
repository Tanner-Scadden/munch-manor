import { Array, Function, Schema } from 'effect'

// Run modifiers (GAME_DESIGN.md, "Decided"): opt-in rules that make a run
// harder and pay more. They are World rules, so the co-op room runs them
// too; this module is the pure leaf both sides read: the set, its bonus, and
// the mask the room's lobby keeps it as. The rules themselves live where
// each one bites (src/world/party/party.ts, src/world/run/difficulty.ts, src/world/fridge/leftovers.ts,
// src/world/gear/powerups.ts, src/world/heroes/callingPlayer.ts).

// THE SET

export const Modifier = Schema.Literals([
  'FriendlyFire',
  'BigCrowd',
  'Broke',
  'Glass',
])
export type Modifier = typeof Modifier.Type

// NOTE: the order the tiles sit in, and the bit each one is in the lobby's
// mask (the first is bit 0). A new modifier goes on the end.
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

// THE BONUS

// NOTE: what each modifier adds to the run's rank points and Bones, in
// percent. The bonuses add (all four are +465%) and the sum multiplies the
// pay (src/world/heroes/rank.ts). Friendly Fire pays least: it costs nothing alone and
// bites only with teammates. Big Crowd stays at +25% on purpose (the owner,
// 2026-11-02): bragging rights. Broke and Glass were set from the balance
// bot's expected points (GAME_DESIGN.md, "Run modifier bonuses"): Glass sells
// no spare hearts, so one heart is the sharpest edge, and pays most.
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

// THE MASK

// NOTE: the lobby keeps the set as one small number (Lobby.ts in the netcode
// package, which cannot read this module): a bit for each modifier, in
// MODIFIER_ORDER.
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

// RULES

// NOTE: Broke drops half the keys (src/world/keys/keys.ts), and the fridge
// stays locked (src/world/fridge/leftovers.ts).
const BROKE_KEY_SCALE = 0.5

export const brokeKeyScaleOf = (modifiers: Modifiers): number =>
  modifiers.broke ? BROKE_KEY_SCALE : 1

// NOTE: Big Crowd brings half as many zombies again.
export const BIG_CROWD_SCALE = 1.5

// NOTE: Glass starts every player on one heart.
export const GLASS_START_HEARTS = 1
