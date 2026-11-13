import { Array, Function, Option, Order, Record } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import {
  type MasterySkin,
  type SavedMastery,
  gunKillsOf,
  heroPointsOf,
} from '../shared/masteryData'
import type { Calling, PropStyle } from '../shared/playerData'
import { CALLINGS } from '../world/heroes/calling'
import type { WeaponKind } from '../world/schema/worldSchema'
import { MasteryUnlock } from './clientSchema'

// Hero and gun mastery's client rules (docs/PROGRESSION_PLAN.md, pillar D):
// what a hero's points and a gun's kills (src/shared/masteryData.ts) reach,
// what each level opens, and what a run's payout opened. Read by the
// payout (src/features/end/masteryRun.ts), the Profile's MASTERY tab, the
// end card's flips, the Dare Journal's hero pages, and the drawing.

// HEROES

// NOTE: what a run pays its hero's track: every wave cleared and every
// dare thing found, never a win itself, so a run that goes badly still
// counts (owner brief, 2026-11-13).
export const POINTS_PER_WAVE = 10
export const POINTS_PER_THING = 25

// NOTE: the points each level asks, in all. About a run's worth for the
// first, then a dozen or so runs on one hero for the gold prop.
const HERO_LEVEL_POINTS: Array.NonEmptyReadonlyArray<number> = [
  100, 300, 600, 1000, 1500,
]

export const MAX_HERO_LEVEL = HERO_LEVEL_POINTS.length

// NOTE: what each level opens: a prop style to wear, or the hero's second
// page in the Dare Journal (Story) at level 3, between the styles.
export type HeroReward = PropStyle | 'Story'

const HERO_REWARDS: Array.NonEmptyReadonlyArray<HeroReward> = [
  'Silver',
  'Night',
  'Story',
  'Ember',
  'Gold',
]

const heroLevelOf = (points: number): number =>
  Array.length(Array.filter(HERO_LEVEL_POINTS, at => points >= at))

export const heroLevelIn: {
  (calling: Calling): (mastery: SavedMastery) => number
  (mastery: SavedMastery, calling: Calling): number
} = Function.dual(2, (mastery: SavedMastery, calling: Calling): number =>
  heroLevelOf(heroPointsOf(mastery, calling)),
)

export const heroRewardAt = (level: number): Option.Option<HeroReward> =>
  Array.get(HERO_REWARDS, level - 1)

// NOTE: the level a prop style opens at, 0 for Stock.
const STYLE_LEVELS: Readonly<Record<PropStyle, number>> = {
  Stock: 0,
  Silver: 1,
  Night: 2,
  Ember: 4,
  Gold: 5,
}

export const PROP_STYLES: Array.NonEmptyReadonlyArray<PropStyle> = [
  'Stock',
  'Silver',
  'Night',
  'Ember',
  'Gold',
]

export const styleLevelOf = (style: PropStyle): number => STYLE_LEVELS[style]

// NOTE: whether a hero's track has opened a prop style.
export const isStyleOpen: {
  (calling: Calling, style: PropStyle): (mastery: SavedMastery) => boolean
  (mastery: SavedMastery, calling: Calling, style: PropStyle): boolean
} = Function.dual(
  3,
  (mastery: SavedMastery, calling: Calling, style: PropStyle): boolean =>
    heroLevelIn(mastery, calling) >= styleLevelOf(style),
)

const HERO_STORY_LEVEL = 3

// NOTE: whether the hero's second Journal page is open.
export const isHeroStoryOpen: {
  (calling: Calling): (mastery: SavedMastery) => boolean
  (mastery: SavedMastery, calling: Calling): boolean
} = Function.dual(
  2,
  (mastery: SavedMastery, calling: Calling): boolean =>
    heroLevelIn(mastery, calling) >= HERO_STORY_LEVEL,
)

// NOTE: a track's bar: its count, the count the next step asks (or the
// last step's, once done), the share of the way there from the step
// before, and the reward next, or none once the track is full.
export type TrackProgress<Reward> = Readonly<{
  count: number
  level: number
  maybeNext: Option.Option<Readonly<{ at: number; reward: Reward }>>
  share: number
}>

const progressOf = <Reward>(
  count: number,
  steps: Array.NonEmptyReadonlyArray<number>,
  rewardAt: (level: number) => Option.Option<Reward>,
): TrackProgress<Reward> => {
  const level = Array.length(Array.filter(steps, at => count >= at))
  const from =
    level === 0 ? 0 : Option.getOrElse(Array.get(steps, level - 1), () => 0)
  const maybeNext = Option.flatMap(Array.get(steps, level), at =>
    Option.map(rewardAt(level + 1), reward => ({ at, reward })),
  )
  const share = Option.match(maybeNext, {
    onNone: () => 1,
    onSome: ({ at }) => Math.min(1, Math.max(0, (count - from) / (at - from))),
  })
  return { count, level, maybeNext, share }
}

export const heroProgressOf: {
  (calling: Calling): (mastery: SavedMastery) => TrackProgress<HeroReward>
  (mastery: SavedMastery, calling: Calling): TrackProgress<HeroReward>
} = Function.dual(
  2,
  (mastery: SavedMastery, calling: Calling): TrackProgress<HeroReward> =>
    progressOf(heroPointsOf(mastery, calling), HERO_LEVEL_POINTS, heroRewardAt),
)

// NOTE: the look's prop style kept to what the hero picked has opened:
// a style its track has not reached goes back to Stock, after any change
// (picking another hero, a synced save, a save read). The same Model
// comes back when it fits, which is nearly always.
export const fitPropStyle = (model: Model): Model => {
  const style = model.appearance.propStyle
  return style === 'Stock' || isStyleOpen(model.mastery, model.calling, style)
    ? model
    : modifyFields(model, {
        appearance: look => modifyFields(look, { propStyle: () => 'Stock' }),
      })
}

// GUNS

// NOTE: a gun's skins by its lifetime kills: a Gilded gun at 1,000, then
// Diamond at 2,500 (owner brief, 2026-11-13: a Gold-type skin at 1,000
// and one more step).
const GUN_SKIN_KILLS: Array.NonEmptyReadonlyArray<
  readonly [number, MasterySkin]
> = [
  [1000, 'Gilded'],
  [2500, 'Diamond'],
]

const GUN_KILL_STEPS: Array.NonEmptyReadonlyArray<number> = Array.map(
  GUN_SKIN_KILLS,
  ([at]) => at,
)

const gunRewardAt = (level: number): Option.Option<MasterySkin> =>
  Option.map(Array.get(GUN_SKIN_KILLS, level - 1), ([, skin]) => skin)

// NOTE: the best skin a gun's kills have opened, or none yet.
export const masterySkinOf = (kills: number): Option.Option<MasterySkin> =>
  gunRewardAt(Array.length(Array.filter(GUN_KILL_STEPS, at => kills >= at)))

export const masterySkinIn: {
  (kind: WeaponKind): (mastery: SavedMastery) => Option.Option<MasterySkin>
  (mastery: SavedMastery, kind: WeaponKind): Option.Option<MasterySkin>
} = Function.dual(
  2,
  (mastery: SavedMastery, kind: WeaponKind): Option.Option<MasterySkin> =>
    masterySkinOf(gunKillsOf(mastery, kind)),
)

export const gunProgressOf: {
  (kind: WeaponKind): (mastery: SavedMastery) => TrackProgress<MasterySkin>
  (mastery: SavedMastery, kind: WeaponKind): TrackProgress<MasterySkin>
} = Function.dual(
  2,
  (mastery: SavedMastery, kind: WeaponKind): TrackProgress<MasterySkin> =>
    progressOf(gunKillsOf(mastery, kind), GUN_KILL_STEPS, gunRewardAt),
)

// WHAT A PAYOUT OPENED

const levelsCrossed = (
  steps: ReadonlyArray<number>,
  before: number,
  after: number,
): ReadonlyArray<number> =>
  Array.getSomes(
    Array.map(steps, (at, index) =>
      before < at && after >= at ? Option.some(index + 1) : Option.none(),
    ),
  )

// NOTE: every hero level and gun skin `after` reached that `before` had
// not, heroes first, then guns by the kills they reached.
export const unlocksBetween: {
  (after: SavedMastery): (before: SavedMastery) => ReadonlyArray<MasteryUnlock>
  (before: SavedMastery, after: SavedMastery): ReadonlyArray<MasteryUnlock>
} = Function.dual(
  2,
  (before: SavedMastery, after: SavedMastery): ReadonlyArray<MasteryUnlock> => {
    const heroes = Array.flatMap(Record.keys(after.heroes), calling =>
      Array.map(
        levelsCrossed(
          HERO_LEVEL_POINTS,
          heroPointsOf(before, calling),
          heroPointsOf(after, calling),
        ),
        level => ({ calling, level }),
      ),
    )
    const guns = Array.flatMap(Record.keys(after.guns), kind =>
      Array.map(
        levelsCrossed(
          GUN_KILL_STEPS,
          gunKillsOf(before, kind),
          gunKillsOf(after, kind),
        ),
        level => ({ kind, level }),
      ),
    )
    return [
      ...Array.getSomes(
        Array.map(heroes, ({ calling, level }) =>
          Option.map(callingOfKey(calling), (known): MasteryUnlock =>
            MasteryUnlock.HeroLevel({ calling: known, level }),
          ),
        ),
      ),
      ...Array.getSomes(
        Array.map(
          Array.sort(
            guns,
            Order.mapInput(
              Order.Number,
              ({ level }: { level: number }) => level,
            ),
          ),
          ({ kind, level }) =>
            Option.flatMap(weaponOfKey(kind), known =>
              Option.map(gunRewardAt(level), (skin): MasteryUnlock =>
                MasteryUnlock.GunMastery({ kind: known, skin }),
              ),
            ),
        ),
      ),
    ]
  },
)

const callingOfKey = (key: string): Option.Option<Calling> =>
  Array.findFirst(CALLINGS, calling => calling === key)

export const MASTERY_GUNS: Array.NonEmptyReadonlyArray<WeaponKind> = [
  'Pistol',
  'Shotgun',
  'Smg',
  'Rifle',
  'Blunderbuss',
  'Peashooter',
  'Cooker',
  'Pan',
  'Freeze',
]

const weaponOfKey = (key: string): Option.Option<WeaponKind> =>
  Array.findFirst(MASTERY_GUNS, kind => kind === key)
