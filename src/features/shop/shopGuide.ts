import { Array, Function, Option, Record, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { HouseSpot, type ShopGuideSection } from '../../app/clientSchema'
import type { Model } from '../../app/model'
import { TRAP_REPAIR_SHARE, TURRET_RANGE_PX } from '../../shared/constants'
import {
  COOKER_RULES,
  FREEZE_RULES,
  PAN_RULES,
} from '../../world/fridge/fridgeWeapons'
import {
  DUD_REFUND,
  FRIDGE_RULES,
  PRIZE_ORDER,
  PRIZE_WEIGHTS,
} from '../../world/fridge/leftovers'
import { TRAPS, TRAP_KIND_ORDER } from '../../world/gear/traps'
import {
  SHOP_GUNS,
  UPGRADE_TIERS,
  WEAPONS,
  maxTier,
  statsAt,
} from '../../world/gear/weapons'
import { VALVE_RULES } from '../../world/kitchen/gasValve'
import { STOVE_RULES } from '../../world/kitchen/stove'
import { EXIT_RULES, KITCHEN_EXIT, exitName } from '../../world/level/exits'
import {
  HOUSE_NAMES,
  PRIZE_NAMES,
  SHOP_GOOD_NAMES,
  SHOP_GUIDE_SECTION_NAMES,
} from '../../world/names'
import {
  type FixedShopItemId,
  FridgeDoor,
  FridgePrize,
  ShopItemId,
  type TrapKind,
  WeaponKind,
} from '../../world/schema/worldSchema'
import {
  LASER_SIGHT_PRICE,
  SHOP_ITEMS,
  ShopGood,
  repairItemId,
} from '../../world/shop/shop'
import { SHATTER_SCALE } from '../../world/step/combat'
import { BAR_SEGMENTS } from './shopStats'

// THE SHOP GUIDE

// NOTE: a page for everything Rattles sells and the places around the house
// where money changes hands. It reads every number from the tables the game
// plays by (src/world/gear/weapons.ts, src/world/gear/traps.ts, src/world/shop/shop.ts, src/world/fridge/leftovers.ts,
// src/world/level/exits.ts), so a bar moves when a table does. Each stat is a bar of
// BAR_SEGMENTS, scaled against the best of its category, so the entries of a
// section compare. Nothing here names a price or a stat by hand.

export const SHOP_GUIDE_OPEN_ID = 'shop-guide-open'
export const SHOP_GUIDE_BACK_ID = 'shop-guide-back'

export const SECTION_ORDER: Array.NonEmptyReadonlyArray<ShopGuideSection> = [
  'Guns',
  'Health',
  'Traps',
  'Fridge',
  'House',
]

export const sectionName = (section: ShopGuideSection): string =>
  SHOP_GUIDE_SECTION_NAMES[section]

// ART

// NOTE: which picture an entry, a ladder step, or a chip wears. The pixels
// are in src/features/shop/shopGuideArt.ts.
export const GuideArt = defineTaggedUnion({
  Gun: { weapon: WeaponKind, tier: Schema.Finite },
  Item: { id: ShopItemId },
  Prize: { prize: FridgePrize },
  House: { spot: HouseSpot },
  Heart: {},
})
export type GuideArt = typeof GuideArt.Type

// BARS

export type GuideStat =
  | 'Power'
  | 'Speed'
  | 'Magazine'
  | 'Reach'
  | 'Reload'
  | 'Shove'
  | 'Tough'
  | 'Block'
  | 'Range'
  | 'Odds'

export const STAT_NAMES: Readonly<Record<GuideStat, string>> = {
  Power: 'Power',
  Speed: 'Speed',
  Magazine: 'Magazine',
  Reach: 'Reach',
  Reload: 'Reload',
  Shove: 'Shove',
  Tough: 'Tough',
  Block: 'Block',
  Range: 'Range',
  Odds: 'Odds',
}

// NOTE: `now` is the bar as bought, `best` the bar with every upgrade on, both
// out of BAR_SEGMENTS. A bar with nothing to show is 0 and stays empty.
export type GuideBar = Readonly<{
  stat: GuideStat
  now: number
  best: number
}>

const segmentsOf = (value: number, most: number): number =>
  value <= 0 || most <= 0
    ? 0
    : Math.max(
        1,
        Math.min(BAR_SEGMENTS, Math.round((value / most) * BAR_SEGMENTS)),
      )

// ENTRIES

export type LadderStep = Readonly<{ art: GuideArt; price: number }>

export type GuideChip = Readonly<{ art: GuideArt; label: string }>

export type GuideEntry = Readonly<{
  id: string
  section: ShopGuideSection
  name: string
  line: string
  art: GuideArt
  price: Option.Option<number>
  bars: ReadonlyArray<GuideBar>
  ladder: ReadonlyArray<LadderStep>
  chips: ReadonlyArray<GuideChip>
  prize: Option.Option<FridgePrize>
}>

// GUNS

type StatReader = (weapon: WeaponKind, tier: number) => number

const GUN_STATS: ReadonlyArray<readonly [GuideStat, StatReader]> = [
  [
    'Power',
    (weapon, tier) => {
      const stats = statsAt(weapon, tier)
      return stats.damage * stats.pellets
    },
  ],
  ['Speed', (weapon, tier) => 1 / statsAt(weapon, tier).fireIntervalMs],
  ['Magazine', (weapon, tier) => statsAt(weapon, tier).magazine],
  [
    'Reach',
    (weapon, tier) => {
      const stats = statsAt(weapon, tier)
      return stats.bulletSpeed * stats.bulletLifetimeMs
    },
  ],
  [
    'Reload',
    (weapon, tier) => {
      const { reloadMs } = statsAt(weapon, tier)
      return reloadMs > 0 ? 1 / reloadMs : 0
    },
  ],
]

const everyTier = (weapon: WeaponKind): ReadonlyArray<number> =>
  Array.makeBy(maxTier(weapon) + 1, tier => tier)

const gunBest = (read: StatReader): number =>
  Math.max(
    ...Array.flatMap(SHOP_GUNS, weapon =>
      Array.map(everyTier(weapon), tier => read(weapon, tier)),
    ),
  )

const gunBars = (weapon: WeaponKind): ReadonlyArray<GuideBar> =>
  Array.map(GUN_STATS, ([stat, read]) => {
    const most = gunBest(read)
    return {
      stat,
      now: segmentsOf(read(weapon, 0), most),
      best: segmentsOf(read(weapon, maxTier(weapon)), most),
    }
  })

const ladderOf = (weapon: WeaponKind): ReadonlyArray<LadderStep> =>
  Array.map(UPGRADE_TIERS[weapon], (tier, index) => ({
    art: GuideArt.Gun({ weapon, tier: index + 1 }),
    price: tier.price,
  }))

// NOTE: the shop's own ammo for a gun, as the guide's chips: the sack, the
// drum, or the stack, with the rounds it adds.
const ammoChips = (weapon: WeaponKind): ReadonlyArray<GuideChip> =>
  Array.flatMap(Record.values(SHOP_ITEMS), item =>
    ShopGood.matchOrElse(
      item.good,
      {
        Ammo: (good): ReadonlyArray<GuideChip> =>
          good.weapon === weapon
            ? [
                {
                  art: GuideArt.Item({ id: item.id }),
                  label: `+${good.rounds} $${item.price}`,
                },
              ]
            : [],
      },
      () => [],
    ),
  )

const gunEntry = (
  weapon: WeaponKind,
  item: FixedShopItemId,
  line: string,
): GuideEntry => ({
  id: weapon,
  section: 'Guns',
  name: WEAPONS[weapon].name,
  line,
  art: GuideArt.Gun({ weapon, tier: 0 }),
  price:
    SHOP_ITEMS[item].price > 0
      ? Option.some(SHOP_ITEMS[item].price)
      : Option.none(),
  bars: gunBars(weapon),
  ladder: ladderOf(weapon),
  chips: ammoChips(weapon),
  prize: Option.none(),
})

const gunEntries = (): ReadonlyArray<GuideEntry> => [
  gunEntry('Pistol', 'Pistol', 'Never runs dry. Always free.'),
  gunEntry('Shotgun', 'Shotgun', 'Seven pellets. Up close only.'),
  gunEntry('Smg', 'Smg', 'Fast and a little wobbly.'),
  {
    id: 'LaserSight',
    section: 'Guns',
    name: SHOP_ITEMS.LaserSight.name,
    line: 'Shows where the shot goes.',
    art: GuideArt.Item({ id: 'LaserSight' }),
    price: Option.some(LASER_SIGHT_PRICE),
    bars: [],
    ladder: [],
    chips: [],
    prize: Option.none(),
  },
]

// HEALTH

const healthEntries = (): ReadonlyArray<GuideEntry> => [
  {
    id: 'Heart',
    section: 'Health',
    name: SHOP_ITEMS.Heart.name,
    line: 'One spare heart.',
    art: GuideArt.Item({ id: 'Heart' }),
    price: Option.some(SHOP_ITEMS.Heart.price),
    bars: [],
    ladder: [],
    chips: [{ art: GuideArt.Heart(), label: '+1' }],
    prize: Option.none(),
  },
]

// TRAPS

const mostOf = (read: (kind: TrapKind) => number): number =>
  Math.max(...Array.map(TRAP_KIND_ORDER, read))

const rangeOf = (kind: TrapKind): number =>
  kind === 'Turret' ? TURRET_RANGE_PX : 0

const trapBars = (kind: TrapKind): ReadonlyArray<GuideBar> => {
  const bar = (stat: GuideStat, read: (kind: TrapKind) => number): GuideBar => {
    const now = segmentsOf(read(kind), mostOf(read))
    return { stat, now, best: now }
  }
  return [
    bar('Tough', other => TRAPS[other].hp),
    bar('Block', other => TRAPS[other].pathCost),
    bar('Range', rangeOf),
  ]
}

const trapEntry = (
  kind: TrapKind,
  item: FixedShopItemId,
  line: string,
): GuideEntry => ({
  id: kind,
  section: 'Traps',
  name: TRAPS[kind].name,
  line,
  art: GuideArt.Item({ id: item }),
  price: Option.some(TRAPS[kind].price),
  bars: trapBars(kind),
  ladder: [],
  chips: [],
  prize: Option.none(),
})

const trapEntries = (): ReadonlyArray<GuideEntry> => [
  trapEntry('Barricade', 'Barricade', 'Slow zombies stop to chew it.'),
  trapEntry('Turret', 'Turret', 'Shoots whatever gets close.'),
  {
    id: 'Repair',
    section: 'Traps',
    name: SHOP_GOOD_NAMES.Repair,
    line: 'Fixes damage. Half price.',
    art: GuideArt.Item({ id: repairItemId(0) }),
    price: Option.none(),
    bars: [],
    ladder: [],
    chips: [
      {
        art: GuideArt.Item({ id: repairItemId(0) }),
        label: `${Math.round(TRAP_REPAIR_SHARE * 100)}%`,
      },
    ],
    prize: Option.none(),
  },
]

// THE FRIDGE

type FridgeStats = Readonly<{ power: number; reach: number; shove: number }>

const fridgeStats = (): Readonly<Record<string, FridgeStats>> => ({
  Cooker: {
    power: COOKER_RULES.maxDamage,
    reach: COOKER_RULES.maxThrowPx,
    shove: COOKER_RULES.knockback,
  },
  Pan: {
    power: PAN_RULES.damage,
    reach: PAN_RULES.reachPx,
    shove: PAN_RULES.knockback,
  },
  Freeze: {
    power: SHATTER_SCALE,
    reach: FREEZE_RULES.reachPx,
    shove: 0,
  },
})

const fridgeMost = (read: (stats: FridgeStats) => number): number =>
  Math.max(...Array.map(Record.values(fridgeStats()), read))

const mostOdds = (): number => Math.max(...Record.values(PRIZE_WEIGHTS))

const prizeBars = (prize: FridgePrize): ReadonlyArray<GuideBar> => {
  const odds: GuideBar = {
    stat: 'Odds',
    now: segmentsOf(PRIZE_WEIGHTS[prize], mostOdds()),
    best: segmentsOf(PRIZE_WEIGHTS[prize], mostOdds()),
  }
  const stats = fridgeStats()[prize]
  if (stats === undefined) {
    return [odds]
  }
  const bar = (
    stat: GuideStat,
    read: (own: FridgeStats) => number,
  ): GuideBar => {
    const now = segmentsOf(read(stats), fridgeMost(read))
    return { stat, now, best: now }
  }
  return [
    bar('Power', own => own.power),
    bar('Reach', own => own.reach),
    bar('Shove', own => own.shove),
    odds,
  ]
}

const PRIZE_WEAPONS: Readonly<Partial<Record<FridgePrize, WeaponKind>>> = {
  Cooker: 'Cooker',
  Pan: 'Pan',
  Freeze: 'Freeze',
}

const PRIZE_LINES: Readonly<Record<FridgePrize, string>> = {
  Cooker: 'Hold, let go, lid goes boom.',
  Pan: 'Swings for the fences.',
  Freeze: 'Freezes small zombies solid.',
  Sandwich: 'Heals a heart. Burps cash back.',
  Dud: 'Fish bones. Burps cash back.',
}

const prizeChips = (prize: FridgePrize): ReadonlyArray<GuideChip> =>
  prize === 'Sandwich'
    ? [
        { art: GuideArt.Heart(), label: '+1' },
        { art: GuideArt.House({ spot: 'Fridge' }), label: `$${DUD_REFUND}` },
      ]
    : prize === 'Dud'
      ? [{ art: GuideArt.House({ spot: 'Fridge' }), label: `$${DUD_REFUND}` }]
      : []

const prizeEntry = (prize: FridgePrize): GuideEntry => {
  const weapon = PRIZE_WEAPONS[prize]
  return {
    id: prize,
    section: 'Fridge',
    name: PRIZE_NAMES[prize],
    line: PRIZE_LINES[prize],
    art: GuideArt.Prize({ prize }),
    price: Option.none(),
    bars: prizeBars(prize),
    ladder: weapon === undefined ? [] : ladderOf(weapon),
    chips: prizeChips(prize),
    prize: Option.some(prize),
  }
}

const fridgeEntries = (): ReadonlyArray<GuideEntry> =>
  Array.map(PRIZE_ORDER, prizeEntry)

// THE HOUSE

const houseEntry = (
  spot: HouseSpot,
  line: string,
  price: Option.Option<number>,
  chips: ReadonlyArray<GuideChip> = [],
): GuideEntry => ({
  id: spot,
  section: 'House',
  name: HOUSE_NAMES[spot],
  line,
  art: GuideArt.House({ spot }),
  price,
  bars: [],
  ladder: [],
  chips,
  prize: Option.none(),
})

const houseEntries = (): ReadonlyArray<GuideEntry> => [
  houseEntry('Stall', 'Open between waves. Walk up.', Option.none()),
  houseEntry(
    'Window',
    'Mid-wave. Tap for more ammo.',
    Option.none(),
    Array.appendAll(Array.flatMap(SHOP_GUNS, ammoChips), ammoChips('Cooker')),
  ),
  houseEntry(
    'Boards',
    `From wave ${EXIT_RULES.firstWave}. Hold to open ${exitName(KITCHEN_EXIT)}.`,
    Option.some(EXIT_RULES.price),
  ),
  houseEntry(
    'Fridge',
    `Hold to pull. First pull a break: $${FRIDGE_RULES.firstPrice}.`,
    Option.some(FRIDGE_RULES.price),
  ),
  houseEntry(
    'Stove',
    'In a break. Hold to cook your gun.',
    Option.some(STOVE_RULES.prices[0]),
  ),
  houseEntry(
    'Valve',
    'Hold to light the fireplace.',
    Option.some(VALVE_RULES.price),
  ),
]

// NOTE: built on each call, from the tables as they stand, so a bar or a
// price moves the moment a table does.
const ENTRY_BUILDERS: Readonly<
  Record<ShopGuideSection, () => ReadonlyArray<GuideEntry>>
> = {
  Guns: gunEntries,
  Health: healthEntries,
  Traps: trapEntries,
  Fridge: fridgeEntries,
  House: houseEntries,
}

export const entriesOf = (
  section: ShopGuideSection,
): ReadonlyArray<GuideEntry> => ENTRY_BUILDERS[section]()

// DISCOVERY

// NOTE: a fridge prize shows as ??? until it has been pulled once. Pulls are
// kept in the unlocks seen (SavedSeenUnlocks), a set that already saves and
// syncs, under ids such as `prize:Cooker`.
export const prizeUnlockId = (prize: FridgePrize): string => `prize:${prize}`

const isPrizeKnown = (
  seenUnlocks: ReadonlyArray<string>,
  prize: FridgePrize,
): boolean => Array.contains(seenUnlocks, prizeUnlockId(prize))

export const isEntryKnown: {
  (entry: GuideEntry): (seenUnlocks: ReadonlyArray<string>) => boolean
  (seenUnlocks: ReadonlyArray<string>, entry: GuideEntry): boolean
} = Function.dual(
  2,
  (seenUnlocks: ReadonlyArray<string>, entry: GuideEntry): boolean =>
    Option.match(entry.prize, {
      onNone: () => true,
      onSome: prize => isPrizeKnown(seenUnlocks, prize),
    }),
)

// NOTE: the fridge's door open on a prize is a pull. Run after every
// Message, it adds that prize to the ones seen.
export const notePulledPrize = (model: Model): Model =>
  FridgeDoor.matchOrElse(
    model.fridge.door,
    {
      Open: ({ prize }) => withPrizeSeen(model, prize),
      Offering: ({ prize }) => withPrizeSeen(model, prize),
    },
    () => model,
  )

const withPrizeSeen = (model: Model, prize: FridgePrize): Model =>
  isPrizeKnown(model.seenUnlocks, prize)
    ? model
    : modifyFields(model, {
        seenUnlocks: seen => [...seen, prizeUnlockId(prize)],
      })
