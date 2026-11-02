import { Array, Schema } from 'effect'

// Run modifiers (GAME_DESIGN.md, "Decided"): opt-in rules that make a run
// harder and pay more. They are World rules, so the co-op room runs them
// too; this module is the pure leaf both sides read: the set, its bonus, and
// the mask the room's lobby keeps it as. The rules themselves live where
// each one bites (src/party.ts, src/difficulty.ts, src/leftovers.ts,
// src/powerups.ts, src/callingPlayer.ts).

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

export const isModifierOn = (
  modifiers: Modifiers,
  modifier: Modifier,
): boolean => modifiers[FIELD_OF[modifier]]

export const toggledModifier = (
  modifiers: Modifiers,
  modifier: Modifier,
): Modifiers => ({
  ...modifiers,
  [FIELD_OF[modifier]]: !isModifierOn(modifiers, modifier),
})

export const modifiersOn = (modifiers: Modifiers): ReadonlyArray<Modifier> =>
  Array.filter(MODIFIER_ORDER, modifier => isModifierOn(modifiers, modifier))

// THE BONUS

// NOTE: what each modifier adds to the run's rank points and Bones, in
// percent. The bonuses add (all four are +115%) and the sum multiplies the
// pay (src/rank.ts). Friendly Fire pays least: it costs nothing alone and
// bites only with teammates. Glass pays most: one heart is the sharpest
// edge. Broke and Big Crowd sit between, one starves the wallet and the
// other fills the room.
const BONUS_PERCENT: Readonly<Record<Modifier, number>> = {
  FriendlyFire: 15,
  BigCrowd: 25,
  Broke: 25,
  Glass: 50,
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

// NOTE: Broke pays half of each kill, to the nearest dollar and never
// nothing, as the Penny Pincher's cut rounds (src/calling.ts).
export const brokenKillPay = (modifiers: Modifiers, pay: number): number =>
  modifiers.broke && pay > 0 ? Math.max(1, Math.round(pay / 2)) : pay

// NOTE: Big Crowd brings half as many zombies again.
export const BIG_CROWD_SCALE = 1.5

// NOTE: Glass starts every player on one heart.
export const GLASS_START_HEARTS = 1
