import { Array, Function, Option, pipe } from 'effect'

import { WEAPONS, statsAt } from '#world/gear/weapons.ts'
import type { WeaponKind } from '#world/schema/worldSchema.ts'
import { hundredths } from '#world/step/geometry.ts'

const changeText = (
  before: number,
  after: number,
  describe: (from: number, to: number) => string,
): ReadonlyArray<string> => (before === after ? [] : [describe(before, after)])

const FRIDGE_TIER_WORDS: Readonly<
  Partial<Record<WeaponKind, ReadonlyArray<string>>>
> = {
  Cooker: ['Bigger blast', 'Faster build', '+2 lids'],
  Pan: ['Wider swing', 'Dents slower', 'Hold to smash'],
}

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
        hundredths(before.spread),
        hundredths(after.spread),
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
