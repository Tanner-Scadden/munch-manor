import { Array, Function, Option } from 'effect'

import { BAR_SEGMENTS } from '../../art/shopArt'
import { TRAPS, healthShare, placedCount } from '../../world/gear/traps'
import {
  SHOP_GUNS,
  WEAPONS,
  isCarrying,
  maxTier,
  maybeCarried,
  maybeReplacedGun,
  statsAt,
  tierName,
  tierOf,
} from '../../world/gear/weapons'
import { maxHpOf } from '../../world/heroes/calling'
import { seatStateAt } from '../../world/party/party'
import type { World } from '../../world/schema/world'
import type {
  PlayerSlot,
  ShopItemId,
  WeaponKind,
} from '../../world/schema/worldSchema'
import {
  ShopGood,
  gunName,
  maybeRepairTrap,
  shopItem,
} from '../../world/shop/shop'

// What the shop dialog shows about a gun and about what a player holds: a
// gun's bars and the note under an item.

export type GunBars = Readonly<{
  hit: number
  rate: number
  load: number
}>

const ALL_TIERS = Array.flatMap(SHOP_GUNS, weapon =>
  Array.makeBy(maxTier(weapon) + 1, tier => statsAt(weapon, tier)),
)

const MAX_HIT = Math.max(
  ...Array.map(ALL_TIERS, stats => stats.damage * stats.pellets),
)
const MAX_RATE = Math.max(
  ...Array.map(ALL_TIERS, stats => 1 / stats.fireIntervalMs),
)
const MAX_LOAD = Math.max(...Array.map(ALL_TIERS, stats => stats.magazine))

const segments = (value: number, most: number): number =>
  Math.max(1, Math.min(BAR_SEGMENTS, Math.round((value / most) * BAR_SEGMENTS)))

export const gunBars: {
  (tier: number): (weapon: WeaponKind) => GunBars
  (weapon: WeaponKind, tier: number): GunBars
} = Function.dual(2, (weapon: WeaponKind, tier: number): GunBars => {
  const stats = statsAt(weapon, tier)
  return {
    hit: segments(stats.damage * stats.pellets, MAX_HIT),
    rate: segments(1 / stats.fireIntervalMs, MAX_RATE),
    load: segments(stats.magazine, MAX_LOAD),
  }
})

export const ownedNote: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => string
  (model: World, slot: PlayerSlot, id: ShopItemId): string
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, id: ShopItemId): string => {
    const { player } = seatStateAt(model, slot)
    return ShopGood.match(shopItem(id).good, {
      Gun: ({ weapon }) =>
        Option.match(maybeCarried(player, weapon), {
          onSome: gun =>
            `You carry it, ${gun.loaded} ${WEAPONS[weapon].roundsLabel} loaded`,
          onNone: () =>
            Option.match(maybeReplacedGun(player.arsenal), {
              onNone: () => 'Goes in your empty second slot',
              onSome: held =>
                held.tier > 0
                  ? `Replaces your ${tierName(held.kind, held.tier)}, and its upgrades are lost`
                  : `Replaces your ${tierName(held.kind, held.tier)}`,
            }),
        }),
      Upgrade: ({ weapon }) =>
        !isCarrying(player, weapon)
          ? `Buy the ${gunName(model, slot, weapon)} first`
          : `Tier ${tierOf(player, weapon)} of ${maxTier(weapon)}`,
      Heart: () => `Hearts ${player.hp} of ${maxHpOf(player)}`,
      Trap: ({ kind }) =>
        `${seatStateAt(model, slot).trapStock[kind]} ready to place, ${placedCount(model.traps, kind)} placed, up to ${TRAPS[kind].limit}`,
      Repair: () =>
        Option.match(maybeRepairTrap(model, id), {
          onNone: () => 'Gone',
          onSome: trap =>
            `Health ${Math.round(healthShare(trap) * 100)} percent`,
        }),
      Sight: () =>
        seatStateAt(model, slot).laserSight === 'Fitted'
          ? 'Fitted to every gun you carry'
          : 'Shows the shot before you take it',
    })
  },
)
