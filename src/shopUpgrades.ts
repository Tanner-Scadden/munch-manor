import { Array, Option, pipe } from 'effect'

import { MS_PER_SECOND } from './constants'
import { WEAPONS, maxRounds, statsAt } from './weapons'
import type { WeaponKind } from './worldSchema'

// What an upgrade changes, in a few words for the shop dialog: a gun's
// numbers before and after, and the fridge weapons' tier words.

const changeText = (
  before: number,
  after: number,
  describe: (from: number, to: number) => string,
): ReadonlyArray<string> => (before === after ? [] : [describe(before, after)])

const roundTo = (value: number, places: number): number =>
  Math.round(value * 10 ** places) / 10 ** places

// NOTE: the fridge weapons' tiers change what their own table holds
// (src/fridgeWeapons.ts), so each says it in a few words.
const FRIDGE_TIER_WORDS: Readonly<
  Partial<Record<WeaponKind, ReadonlyArray<string>>>
> = {
  Cooker: ['A bigger blast', 'Builds pressure faster', 'Six lids a load'],
  Pan: ['A wider swing', 'Dents half as fast', 'Hold for a ground smash'],
}

export const upgradeChanges = (weapon: WeaponKind, tier: number): string =>
  Option.match(
    Option.flatMap(Option.fromNullishOr(FRIDGE_TIER_WORDS[weapon]), words =>
      Array.get(words, tier),
    ),
    {
      onSome: words => `${words}.`,
      onNone: () => gunUpgradeChanges(weapon, tier),
    },
  )

const gunUpgradeChanges = (weapon: WeaponKind, tier: number): string => {
  const before = statsAt(weapon, tier)
  const after = statsAt(weapon, tier + 1)
  const roundsLabel = WEAPONS[weapon].roundsLabel
  return pipe(
    [
      ...changeText(
        before.damage,
        after.damage,
        (from, to) => `Hits for ${to} instead of ${from}`,
      ),
      ...changeText(
        before.pellets,
        after.pellets,
        (from, to) => `${to} pellets instead of ${from}`,
      ),
      ...changeText(
        before.fireIntervalMs,
        after.fireIntervalMs,
        (from, to) => `${to} ms between shots instead of ${from}`,
      ),
      ...changeText(
        roundTo(before.spread, 2),
        roundTo(after.spread, 2),
        (from, to) => (to < from ? 'Tighter aim' : 'A wider spray'),
      ),
      ...changeText(
        before.magazine,
        after.magazine,
        (from, to) => `Loads ${to} ${roundsLabel} instead of ${from}`,
      ),
      ...changeText(
        before.reloadMs,
        after.reloadMs,
        (from, to) =>
          `Reloads in ${to / MS_PER_SECOND} s instead of ${from / MS_PER_SECOND}`,
      ),
      ...changeText(before.knockback, after.knockback, () => 'A bigger shove'),
      ...changeText(
        maxRounds(weapon, tier),
        maxRounds(weapon, tier + 1),
        (from, to) => `Holds ${to} ${roundsLabel} instead of ${from}`,
      ),
    ],
    Array.join('. '),
    text => `${text}.`,
  )
}
