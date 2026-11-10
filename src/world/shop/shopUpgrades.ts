import { Array, Function, Option, pipe } from 'effect'

import { WEAPONS, statsAt } from '../gear/weapons'
import type { WeaponKind } from '../schema/worldSchema'

// What a gun's new tier changes, in a few words for the level-up callout
// (src/world/gear/gunLevels.ts): a gun's numbers before and after, and the
// fridge weapons' tier words.

const changeText = (
  before: number,
  after: number,
  describe: (from: number, to: number) => string,
): ReadonlyArray<string> => (before === after ? [] : [describe(before, after)])

const roundTo = (value: number, places: number): number =>
  Math.round(value * 10 ** places) / 10 ** places

// NOTE: the fridge weapons' tiers change what their own table holds
// (src/world/fridge/fridgeWeapons.ts), so each says it in a few words, by
// the tier it reaches.
const FRIDGE_TIER_WORDS: Readonly<
  Partial<Record<WeaponKind, ReadonlyArray<string>>>
> = {
  Cooker: ['Bigger blast', 'Faster build', '+2 lids'],
  Pan: ['Wider swing', 'Dents slower', 'Hold to smash'],
}

// NOTE: `tier` is the tier just reached, from 1.
export const levelUpChange: {
  (tier: number): (weapon: WeaponKind) => string
  (weapon: WeaponKind, tier: number): string
} = Function.dual(2, (weapon: WeaponKind, tier: number): string =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(FRIDGE_TIER_WORDS[weapon]), words =>
      Array.get(words, tier - 1),
    ),
    {
      onSome: words => words,
      onNone: () => gunChange(weapon, tier),
    },
  ),
)

const gunChange = (weapon: WeaponKind, tier: number): string => {
  const before = statsAt(weapon, tier - 1)
  const after = statsAt(weapon, tier)
  const roundsLabel = WEAPONS[weapon].roundsLabel
  return pipe(
    [
      ...changeText(
        before.damage,
        after.damage,
        (from, to) => `+${to - from} hit`,
      ),
      ...changeText(
        before.pellets,
        after.pellets,
        (from, to) => `+${to - from} pellets`,
      ),
      ...changeText(
        before.fireIntervalMs,
        after.fireIntervalMs,
        () => 'Faster fire',
      ),
      ...changeText(
        roundTo(before.spread, 2),
        roundTo(after.spread, 2),
        (from, to) => (to < from ? 'Tighter aim' : 'Wider spray'),
      ),
      ...changeText(
        before.magazine,
        after.magazine,
        (from, to) => `+${to - from} ${roundsLabel}`,
      ),
      ...changeText(before.reloadMs, after.reloadMs, () => 'Quick reload'),
      ...changeText(before.knockback, after.knockback, () => 'Bigger shove'),
    ],
    Array.join(', '),
  )
}
