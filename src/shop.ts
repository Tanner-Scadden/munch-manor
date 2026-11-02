import { Array, Option, Order, Result, Schema, String, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { PARLOUR, SHOP_STALL_SYMBOL, tilesWithSymbol } from './arena'
import {
  isPistolBarred,
  isRepairFree,
  maxHpOf,
  plankPriceFor,
  shopPriceFor,
} from './calling'
import {
  MONEY_TICK_PER_SECOND,
  SHOP_FIRST_WAVE,
  SHOP_LEAVE_PX,
  SHOP_NEAR_PX,
  SHOP_REACH_PX,
  TILE_SIZE,
} from './constants'
import { SHOP_GOOD_NAMES } from './names'
import { atSeat, isCoop, modifySeat, seatStateAt } from './party'
import { upgradeChanges } from './shopUpgrades'
import { countPurchase } from './stats'
import {
  TRAPS,
  TRAP_KIND_ORDER,
  isDamaged,
  ownedCount,
  repairPrice,
  repairTrap,
  stockTrap,
  trapLimitOf,
} from './traps'
import {
  SIDEARM,
  WEAPONS,
  type WeaponTier,
  freshGun,
  isCarrying,
  isHolding,
  looseRounds,
  mapCarried,
  mapGuns,
  maxRounds,
  maxTier,
  maybeCarried,
  maybeNextTier,
  maybeReplacedGun,
  putGunInHand,
  startingRounds,
  takeGun,
  tierName,
  tierOf,
} from './weapons'
import type { World } from './world'
import {
  type Arsenal,
  type CarriedGun,
  type FixedShopItemId,
  Lesson,
  Phase,
  type Player,
  type PlayerSlot,
  type RepairItemId,
  type ShopCategory,
  ShopItemId,
  ShopState,
  Trap,
  TrapKind,
  type Vector,
  type Wallet,
  WeaponKind,
} from './worldSchema'

// MONEY

export { earn } from './party'

const spend = (wallet: Wallet, amount: number): Wallet =>
  modifyFields(wallet, { balance: balance => balance - amount })

export const tickShownMoney = (wallet: Wallet, seconds: number): Wallet => {
  const gap = wallet.balance - wallet.shown
  if (gap === 0) {
    return wallet
  }

  const step = Math.max(
    1,
    Math.ceil(Math.abs(gap) * MONEY_TICK_PER_SECOND * seconds),
  )
  return modifyFields(wallet, {
    shown: shown =>
      gap > 0
        ? Math.min(wallet.balance, shown + step)
        : Math.max(wallet.balance, shown - step),
  })
}

// GOODS

export const ShopGood = defineTaggedUnion({
  Gun: { weapon: WeaponKind },
  Ammo: { weapon: WeaponKind, rounds: Schema.Number },
  Upgrade: { weapon: WeaponKind },
  Heart: {},
  Trap: { kind: TrapKind },
  Repair: { trapId: Schema.Number },
  Sight: {},
})
export type ShopGood = typeof ShopGood.Type

// UPGRADES

export const gunName = (
  model: World,
  slot: PlayerSlot,
  weapon: WeaponKind,
): string => tierName(weapon, tierOf(seatStateAt(model, slot).player, weapon))

export const nextGunName = (
  model: World,
  slot: PlayerSlot,
  weapon: WeaponKind,
): string =>
  tierName(weapon, tierOf(seatStateAt(model, slot).player, weapon) + 1)

const nextTierFor = (
  model: World,
  slot: PlayerSlot,
  weapon: WeaponKind,
): Option.Option<WeaponTier> =>
  maybeNextTier(weapon, tierOf(seatStateAt(model, slot).player, weapon))

type ShopItem = Readonly<{
  id: ShopItemId
  name: string
  blurb: string
  price: number
  good: ShopGood
}>

const SHOTGUN_SHELLS = 16
const SMG_ROUNDS = 120
const LID_STACK = 8

// NOTE: the sight is a luxury: it costs about as much as a gun's top
// upgrade, so it is a late-run buy, and it is gone with the run.
export const LASER_SIGHT_PRICE = 400

export const SHOP_ITEMS: Readonly<Record<FixedShopItemId, ShopItem>> = {
  // NOTE: Rattles always sells the pistol back for nothing, so a player
  // who traded it away is never stuck without a gun that never runs dry.
  Pistol: {
    id: 'Pistol',
    name: WEAPONS.Pistol.name,
    blurb: 'Never runs dry. Rattles gives it back for free.',
    price: 0,
    good: ShopGood.Gun({ weapon: 'Pistol' }),
  },
  Shotgun: {
    id: 'Shotgun',
    name: WEAPONS.Shotgun.name,
    blurb: `Sprays seven pellets and shoves hard, but only up close. Comes with ${startingRounds('Shotgun')} shells.`,
    price: 35,
    good: ShopGood.Gun({ weapon: 'Shotgun' }),
  },
  ShotgunShells: {
    id: 'ShotgunShells',
    name: SHOP_GOOD_NAMES.ShotgunShells,
    blurb: `${SHOTGUN_SHELLS} more shells for the ${WEAPONS.Shotgun.name}.`,
    price: 10,
    good: ShopGood.Ammo({ weapon: 'Shotgun', rounds: SHOTGUN_SHELLS }),
  },
  Smg: {
    id: 'Smg',
    name: WEAPONS.Smg.name,
    blurb: `Fast and a little wobbly. Comes with ${startingRounds('Smg')} rounds.`,
    price: 100,
    good: ShopGood.Gun({ weapon: 'Smg' }),
  },
  ShotgunUpgrade: {
    id: 'ShotgunUpgrade',
    name: `${WEAPONS.Shotgun.name} upgrade`,
    blurb: `Bolts something louder onto your ${WEAPONS.Shotgun.name}.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Shotgun' }),
  },
  SmgRounds: {
    id: 'SmgRounds',
    name: SHOP_GOOD_NAMES.SmgRounds,
    blurb: `${SMG_ROUNDS} more rounds for the ${WEAPONS.Smg.name}.`,
    price: 20,
    good: ShopGood.Ammo({ weapon: 'Smg', rounds: SMG_ROUNDS }),
  },
  SmgUpgrade: {
    id: 'SmgUpgrade',
    name: `${WEAPONS.Smg.name} upgrade`,
    blurb: `Teaches your ${WEAPONS.Smg.name} some new words.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Smg' }),
  },
  PistolUpgrade: {
    id: 'PistolUpgrade',
    name: `${WEAPONS.Pistol.name} upgrade`,
    blurb: `Shines up your ${WEAPONS.Pistol.name}.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Pistol' }),
  },
  LaserSight: {
    id: 'LaserSight',
    name: SHOP_GOOD_NAMES.LaserSight,
    blurb:
      'A red line on the floor shows where your shot goes. Fans out for a scattergun. Lasts the run.',
    price: LASER_SIGHT_PRICE,
    good: ShopGood.Sight(),
  },
  Heart: {
    id: 'Heart',
    name: SHOP_GOOD_NAMES.Heart,
    blurb: 'One spare heart, fresh from the jar.',
    price: 25,
    good: ShopGood.Heart(),
  },
  Barricade: {
    id: 'Barricade',
    name: TRAPS.Barricade.name,
    blurb: TRAPS.Barricade.blurb,
    price: TRAPS.Barricade.price,
    good: ShopGood.Trap({ kind: 'Barricade' }),
  },
  Turret: {
    id: 'Turret',
    name: TRAPS.Turret.name,
    blurb: TRAPS.Turret.blurb,
    price: TRAPS.Turret.price,
    good: ShopGood.Trap({ kind: 'Turret' }),
  },
  // NOTE: the fridge weapons are never for sale, only their upgrades and
  // the Cooker's lids, and only once a player has pulled one.
  CookerUpgrade: {
    id: 'CookerUpgrade',
    name: `${WEAPONS.Cooker.name} upgrade`,
    blurb: `Tightens the clamps on your ${WEAPONS.Cooker.name}.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Cooker' }),
  },
  LidStack: {
    id: 'LidStack',
    name: SHOP_GOOD_NAMES.LidStack,
    blurb: `${LID_STACK} more lids for the ${WEAPONS.Cooker.name}.`,
    price: 30,
    good: ShopGood.Ammo({ weapon: 'Cooker', rounds: LID_STACK }),
  },
  PanUpgrade: {
    id: 'PanUpgrade',
    name: `${WEAPONS.Pan.name} upgrade`,
    blurb: `Hammers your ${WEAPONS.Pan.name} into something meaner.`,
    price: 0,
    good: ShopGood.Upgrade({ weapon: 'Pan' }),
  },
}

const REPAIR_PREFIX = 'Repair-'

export const repairItemId = (trapId: number): RepairItemId =>
  `${REPAIR_PREFIX}${trapId}`

const isRepairItem = (id: ShopItemId): id is RepairItemId =>
  String.startsWith(REPAIR_PREFIX)(id)

export const shopItem = (id: ShopItemId): ShopItem =>
  isRepairItem(id)
    ? {
        id,
        name: SHOP_GOOD_NAMES.Repair,
        blurb: 'Fixes this trap. Costs more the worse it looks.',
        price: 0,
        good: ShopGood.Repair({
          trapId: Number(String.slice(REPAIR_PREFIX.length)(id)),
        }),
      }
    : SHOP_ITEMS[id]

// CATEGORIES

type ShopCategoryInfo = Readonly<{
  label: string
  blurb: (model: World) => string
}>

export const SHOP_CATEGORIES: Readonly<Record<ShopCategory, ShopCategoryInfo>> =
  {
    Guns: {
      label: 'Guns',
      blurb: () =>
        'Two guns. A new one replaces the one in your hands, upgrades and all.',
    },
    Health: {
      label: 'Health',
      blurb: model =>
        model.modifiers.glass
          ? 'Glass: one heart, no more.'
          : 'One heart at a time.',
    },
    Traps: {
      label: 'Traps',
      blurb: () =>
        'Set them down between waves. Damage stays until you fix it.',
    },
  }

export const SHOP_CATEGORY_ORDER: Array.NonEmptyReadonlyArray<ShopCategory> = [
  'Guns',
  'Health',
  'Traps',
]

// TRAPS

export type TrapShelf = Readonly<{
  kind: TrapKind
  item: FixedShopItemId
  repairs: ReadonlyArray<ShopItemId>
}>

export const trapShelves = (
  model: World,
): Array.NonEmptyReadonlyArray<TrapShelf> =>
  Array.map(TRAP_KIND_ORDER, kind => ({
    kind,
    item: kind,
    repairs: pipe(
      model.traps,
      Array.filter(trap => trap._tag === kind),
      Array.map(trap => repairItemId(trap.id)),
    ),
  }))

export const maybeRepairTrap = (
  model: World,
  id: ShopItemId,
): Option.Option<Trap> =>
  ShopGood.match(shopItem(id).good, {
    Gun: () => Option.none(),
    Ammo: () => Option.none(),
    Upgrade: () => Option.none(),
    Heart: () => Option.none(),
    Trap: () => Option.none(),
    Repair: ({ trapId }) =>
      Array.findFirst(model.traps, trap => trap.id === trapId),
    Sight: () => Option.none(),
  })

const trapPlace = (trap: Trap): string =>
  Trap.match(trap, {
    Barricade: ({ door }) => `at the ${door} door`,
    Turret: ({ column, row }) => `at column ${column}, row ${row}`,
  })

// GUNS

type GunLine = Readonly<{
  weapon: WeaponKind
  gun: ShopItemId
  items: Array.NonEmptyReadonlyArray<ShopItemId>
  status: (gun: CarriedGun) => string
}>

const roundsStatus = (gun: CarriedGun): string =>
  `${gun.loaded} loaded, ${looseRounds(gun)} spare`

// NOTE: the guns Rattles sells, always in this order, pistol first.
const GUN_LINES: Array.NonEmptyReadonlyArray<GunLine> = [
  {
    weapon: 'Pistol',
    gun: 'Pistol',
    items: ['PistolUpgrade'],
    status: gun => `${gun.loaded} loaded, never runs dry`,
  },
  {
    weapon: 'Shotgun',
    gun: 'Shotgun',
    items: ['ShotgunShells', 'ShotgunUpgrade'],
    status: roundsStatus,
  },
  {
    weapon: 'Smg',
    gun: 'Smg',
    items: ['SmgRounds', 'SmgUpgrade'],
    status: roundsStatus,
  },
]

// NOTE: a fridge weapon has a card only while a player carries it, with
// what Rattles sells for it. Brain Freeze has no tiers and no refills, so
// it has none.
type FridgeLine = Readonly<{
  weapon: WeaponKind
  items: Array.NonEmptyReadonlyArray<ShopItemId>
  status: (spare: CarriedGun) => string
}>

const FRIDGE_LINES: ReadonlyArray<FridgeLine> = [
  {
    weapon: 'Cooker',
    items: ['LidStack', 'CookerUpgrade'],
    status: roundsStatus,
  },
  {
    weapon: 'Pan',
    items: ['PanUpgrade'],
    status: spare =>
      spare.loaded > 0
        ? `${spare.loaded} hits before it dents`
        : 'Dented, Rattles flattens it each break',
  },
]

const fridgeShelves = (player: Player): ReadonlyArray<GunShelf> =>
  Array.filterMap(FRIDGE_LINES, line =>
    Option.match(maybeCarried(player, line.weapon), {
      onNone: () => Result.failVoid,
      onSome: spare =>
        Result.succeed(
          GunShelf.Owned({
            weapon: line.weapon,
            tier: spare.tier,
            status: line.status(spare),
            items: line.items,
          }),
        ),
    }),
  )

export const GunShelf = defineTaggedUnion({
  ForSale: { weapon: WeaponKind, item: ShopItemId },
  Owned: {
    weapon: WeaponKind,
    tier: Schema.Number,
    status: Schema.String,
    items: Schema.NonEmptyArray(ShopItemId),
  },
})
export type GunShelf = typeof GunShelf.Type

const gunShelf = (player: Player, line: GunLine): GunShelf =>
  Option.match(maybeCarried(player, line.weapon), {
    onNone: () => GunShelf.ForSale({ weapon: line.weapon, item: line.gun }),
    onSome: gun =>
      GunShelf.Owned({
        weapon: line.weapon,
        tier: gun.tier,
        status: line.status(gun),
        items: line.items,
      }),
  })

export const gunShelves = (
  model: World,
  slot: PlayerSlot,
): Array.NonEmptyReadonlyArray<GunShelf> =>
  Array.appendAll(
    Array.map(GUN_LINES, line =>
      gunShelf(seatStateAt(model, slot).player, line),
    ),
    fridgeShelves(seatStateAt(model, slot).player),
  )

const shelfItems = (shelf: GunShelf): Array.NonEmptyReadonlyArray<ShopItemId> =>
  GunShelf.match(shelf, {
    ForSale: ({ item }) => Array.of(item),
    Owned: ({ items }) => items,
  })

export const itemsIn = (
  model: World,
  slot: PlayerSlot,
  category: ShopCategory,
): Array.NonEmptyReadonlyArray<ShopItemId> => {
  if (category === 'Guns') {
    return Array.append(
      Array.flatMap(gunShelves(model, slot), shelfItems),
      'LaserSight' as const,
    )
  } else if (category === 'Health') {
    return ['Heart']
  } else {
    return Array.flatMap(trapShelves(model), shelf => [
      shelf.item,
      ...shelf.repairs,
    ])
  }
}

const maybeGunOf = (item: ShopItemId): Option.Option<WeaponKind> =>
  ShopGood.match(shopItem(item).good, {
    Gun: ({ weapon }) => Option.some(weapon),
    Ammo: ({ weapon }) => Option.some(weapon),
    Upgrade: ({ weapon }) => Option.some(weapon),
    Heart: () => Option.none(),
    Trap: () => Option.none(),
    Repair: () => Option.none(),
    Sight: () => Option.none(),
  })

const replacementFor = (
  model: World,
  slot: PlayerSlot,
  item: ShopItemId,
): ShopItemId => {
  const isShown = Array.contains(
    itemsIn(model, slot, seatStateAt(model, slot).shopCategory),
    item,
  )
  if (seatStateAt(model, slot).shopCategory !== 'Guns' || isShown) {
    return item
  }

  return pipe(
    maybeGunOf(item),
    Option.flatMap(weapon =>
      Array.findFirst(
        gunShelves(model, slot),
        shelf => shelf.weapon === weapon,
      ),
    ),
    Option.match({
      onNone: () => item,
      onSome: shelf => Array.headNonEmpty(shelfItems(shelf)),
    }),
  )
}

export const maybeDisplacedFocus = (
  model: World,
  slot: PlayerSlot,
): Option.Option<ShopItemId> =>
  ShopState.match(seatStateAt(model, slot).shop, {
    Away: () => Option.none(),
    Browsing: ({ focusedItem }) =>
      Option.liftPredicate(
        replacementFor(model, slot, focusedItem),
        replacement => replacement !== focusedItem,
      ),
    Dismissed: () => Option.none(),
  })

// NOTE: the guided first break (src/firstBreakQuest.ts) has a new player
// buy a Plank Pile and place it, so a lesson never dead-ends on an empty
// wallet: in a new save's first break (no timer, before any wave 2), with no
// Plank Pile owned yet, the first one is free. Only a player alone; a
// co-op room has its lessons learned. A save past the tutorial never sees it.
export const isFirstPlankFree = (
  model: World,
  slot: PlayerSlot,
  kind: TrapKind,
): boolean =>
  kind === 'Barricade' &&
  !isCoop(model) &&
  Lesson.isAnyOf(['Pending'])(model.lessons.openBreak) &&
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  model.phase.wave === SHOP_FIRST_WAVE &&
  ownedCount(model, slot, 'Barricade') === 0

// NOTE: what Rattles charges the acting player: the list price as the
// calling changes it (the Handyman's Plank Piles, the Penny Pincher's
// discount). The first plank of the guided break stays free, and a price
// of nothing stays nothing.
export const priceFor = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): number => {
  const { calling } = seatStateAt(model, slot).player
  return ShopGood.match(shopItem(id).good, {
    Gun: () => shopPriceFor(calling, shopItem(id).price),
    Ammo: () => shopPriceFor(calling, shopItem(id).price),
    Upgrade: ({ weapon }) =>
      Option.match(nextTierFor(model, slot, weapon), {
        onNone: () => 0,
        onSome: ({ price }) => shopPriceFor(calling, price),
      }),
    Heart: () => shopPriceFor(calling, shopItem(id).price),
    Trap: ({ kind }) =>
      isFirstPlankFree(model, slot, kind)
        ? 0
        : shopPriceFor(
            calling,
            kind === 'Barricade'
              ? plankPriceFor(calling, shopItem(id).price)
              : shopItem(id).price,
          ),
    Repair: () =>
      Option.match(maybeRepairTrap(model, id), {
        onNone: () => 0,
        onSome: trap =>
          isRepairFree(calling)
            ? 0
            : shopPriceFor(calling, repairPrice([trap])),
      }),
    Sight: () => shopPriceFor(calling, shopItem(id).price),
  })
}

const isMaxedUpgrade = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): boolean =>
  ShopGood.match(shopItem(id).good, {
    Gun: () => false,
    Ammo: () => false,
    Upgrade: ({ weapon }) => Option.isNone(nextTierFor(model, slot, weapon)),
    Heart: () => false,
    Trap: () => false,
    Repair: () => false,
    Sight: () => false,
  })

export const priceLabel = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): string =>
  isMaxedUpgrade(model, slot, id) ? 'MAX' : `$${priceFor(model, slot, id)}`

export const itemName = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): string =>
  ShopGood.match(shopItem(id).good, {
    Gun: () => shopItem(id).name,
    Ammo: () => shopItem(id).name,
    Upgrade: ({ weapon }) =>
      Option.match(nextTierFor(model, slot, weapon), {
        onNone: () => `${tierName(weapon, maxTier(weapon))}, fully upgraded`,
        onSome: () => `Upgrade to ${nextGunName(model, slot, weapon)}`,
      }),
    Heart: () => shopItem(id).name,
    Trap: () => shopItem(id).name,
    Repair: () =>
      Option.match(maybeRepairTrap(model, id), {
        onNone: () => shopItem(id).name,
        onSome: trap => `Repair the ${TRAPS[trap._tag].name}`,
      }),
    Sight: () => shopItem(id).name,
  })

const ammoGain = (
  model: World,
  slot: PlayerSlot,
  weapon: WeaponKind,
  rounds: number,
): string => {
  const roundsLabel = WEAPONS[weapon].roundsLabel
  const room = Option.match(
    maybeCarried(seatStateAt(model, slot).player, weapon),
    {
      onNone: () => rounds,
      onSome: spare => maxRounds(weapon, spare.tier) - spare.rounds,
    },
  )
  if (room <= 0) {
    return `adds up to ${rounds} ${roundsLabel}`
  } else if (room < rounds) {
    return `adds ${room} ${roundsLabel} and fills it`
  } else {
    return `adds ${rounds} ${roundsLabel}`
  }
}

export const itemAriaLabel = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): string => {
  const price = `$${priceFor(model, slot, id)}`
  return ShopGood.match(shopItem(id).good, {
    Gun: () => `Buy ${itemName(model, slot, id)} for ${price}`,
    Ammo: ({ weapon, rounds }) =>
      `${itemName(model, slot, id)}, ammo for ${gunName(model, slot, weapon)}, ${price}, ${ammoGain(model, slot, weapon, rounds)}`,
    Upgrade: ({ weapon }) =>
      Option.match(nextTierFor(model, slot, weapon), {
        onNone: () => itemName(model, slot, id),
        onSome: () =>
          `${nextGunName(model, slot, weapon)}, upgrade for ${gunName(model, slot, weapon)}, ${price}`,
      }),
    Heart: () => `Buy ${itemName(model, slot, id)} for ${price}`,
    Trap: () => `Buy ${itemName(model, slot, id)} for ${price}`,
    Repair: () =>
      Option.match(maybeRepairTrap(model, id), {
        onNone: () => `Buy ${itemName(model, slot, id)} for ${price}`,
        onSome: trap =>
          `Repair the ${TRAPS[trap._tag].name} ${trapPlace(trap)}, ${price}`,
      }),
    Sight: () => `Buy ${itemName(model, slot, id)} for ${price}`,
  })
}

export const itemBlurb = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): string =>
  ShopGood.match(shopItem(id).good, {
    Gun: () => shopItem(id).blurb,
    Ammo: ({ weapon, rounds }) =>
      Option.match(maybeCarried(seatStateAt(model, slot).player, weapon), {
        onNone: () => shopItem(id).blurb,
        onSome: spare =>
          `${String.capitalize(ammoGain(model, slot, weapon, rounds))}. You have ${spare.rounds} of ${maxRounds(weapon, spare.tier)}.`,
      }),
    Upgrade: ({ weapon }) => {
      const tier = tierOf(seatStateAt(model, slot).player, weapon)
      return Option.match(nextTierFor(model, slot, weapon), {
        onNone: () =>
          `Your ${gunName(model, slot, weapon)} cannot get any fancier.`,
        onSome: () => upgradeChanges(weapon, tier),
      })
    },
    Heart: () => shopItem(id).blurb,
    Trap: () => shopItem(id).blurb,
    Repair: () => shopItem(id).blurb,
    Sight: () => shopItem(id).blurb,
  })

export const shopItemElementId = (id: ShopItemId): string => `shop-item-${id}`

// VERDICT

export const Verdict = defineTaggedUnion({
  Available: {},
  Refused: { reason: Schema.String },
})
export type Verdict = typeof Verdict.Type

type Block = Readonly<{ reason: string; tag: string }>

const block = (reason: string, tag: string): Option.Option<Block> =>
  Option.some({ reason, tag })

const blockedBy = (
  model: World,
  slot: PlayerSlot,
  good: ShopGood,
): Option.Option<Block> => {
  const { player } = seatStateAt(model, slot)
  return ShopGood.match(good, {
    Gun: ({ weapon }) => {
      if (isCarrying(player, weapon)) {
        return block('You already carry it', 'OWNED')
      } else if (weapon === SIDEARM && isPistolBarred(player.calling)) {
        return block('Rattles will not sell you that', 'NO')
      } else {
        return Option.none()
      }
    },
    Ammo: ({ weapon }) =>
      Option.match(maybeCarried(player, weapon), {
        onNone: () =>
          block(`Needs the ${gunName(model, slot, weapon)}`, 'NO GUN'),
        onSome: spare =>
          spare.rounds >= maxRounds(weapon, spare.tier)
            ? block(`Your ${tierName(weapon, spare.tier)} is full`, 'FULL')
            : Option.none(),
      }),
    Upgrade: ({ weapon }) => {
      if (!isCarrying(player, weapon)) {
        return block(`Needs the ${gunName(model, slot, weapon)}`, 'NO GUN')
      } else if (Option.isNone(nextTierFor(model, slot, weapon))) {
        return block('Fully upgraded', 'MAX')
      } else {
        return Option.none()
      }
    },
    // NOTE: a Glass run (src/modifiers.ts) sells no spare hearts: one heart
    // means one. The item stays on the shelf, marked done like a full jar.
    Heart: () => {
      if (model.modifiers.glass) {
        return block('Glass: no spare hearts', 'GLASS')
      } else if (player.hp >= maxHpOf(player)) {
        return block('Your hearts are full', 'FULL')
      } else {
        return Option.none()
      }
    },
    Trap: ({ kind }) =>
      ownedCount(model, slot, kind) >= trapLimitOf(model, kind)
        ? block(TRAPS[kind].buyLimitNote, 'MAX')
        : Option.none(),
    Repair: ({ trapId }) =>
      Option.match(
        Array.findFirst(model.traps, trap => trap.id === trapId),
        {
          onNone: () => block('That trap is gone', 'GONE'),
          onSome: trap =>
            isDamaged(trap) ? Option.none() : block('Good as new', 'FULL'),
        },
      ),
    Sight: () =>
      seatStateAt(model, slot).laserSight === 'Fitted'
        ? block('Already fitted', 'OWNED')
        : Option.none(),
  })
}

const blockedReason = (
  model: World,
  slot: PlayerSlot,
  good: ShopGood,
): Option.Option<string> =>
  Option.map(blockedBy(model, slot, good), ({ reason }) => reason)

export const verdictFor = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): Verdict => {
  const item = shopItem(id)
  const price = priceFor(model, slot, id)
  return pipe(
    blockedReason(model, slot, item.good),
    Option.orElse(() =>
      price > seatStateAt(model, slot).wallet.balance
        ? Option.some(
            `Need $${price - seatStateAt(model, slot).wallet.balance} more`,
          )
        : Option.none(),
    ),
    Option.match({
      onNone: () => Verdict.Available(),
      onSome: reason => Verdict.Refused({ reason }),
    }),
  )
}

const isAvailable = (model: World, slot: PlayerSlot, id: ShopItemId): boolean =>
  Verdict.isAnyOf(['Available'])(verdictFor(model, slot, id))

export const affordableCount = (
  model: World,
  slot: PlayerSlot,
  category: ShopCategory,
): number =>
  Array.filter(itemsIn(model, slot, category), id =>
    isAvailable(model, slot, id),
  ).length

export const totalAffordable = (model: World, slot: PlayerSlot): number =>
  Array.reduce(
    SHOP_CATEGORY_ORDER,
    0,
    (total, category) => total + affordableCount(model, slot, category),
  )

// TAGS

export const StockTag = defineTaggedUnion({
  Price: { price: Schema.Number },
  Short: { price: Schema.Number, need: Schema.Number },
  Done: { label: Schema.String },
})
export type StockTag = typeof StockTag.Type

export const stockTag = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): StockTag => {
  const price = priceFor(model, slot, id)
  return Option.match(blockedBy(model, slot, shopItem(id).good), {
    onSome: ({ tag }) => StockTag.Done({ label: tag }),
    onNone: () =>
      price > seatStateAt(model, slot).wallet.balance
        ? StockTag.Short({
            price,
            need: price - seatStateAt(model, slot).wallet.balance,
          })
        : StockTag.Price({ price }),
  })
}

// SUGGESTION

const isRunningLow = (
  model: World,
  slot: PlayerSlot,
  weapon: WeaponKind,
): boolean =>
  Option.match(maybeCarried(seatStateAt(model, slot).player, weapon), {
    onNone: () => false,
    onSome: spare => spare.rounds * 2 < maxRounds(weapon, spare.tier),
  })

const suggestionRank = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): number =>
  ShopGood.match(shopItem(id).good, {
    Ammo: ({ weapon }) => (isRunningLow(model, slot, weapon) ? 0 : 3),
    Upgrade: ({ weapon }) => (weapon === SIDEARM ? 2 : 1),
    Gun: () =>
      Option.isNone(maybeReplacedGun(seatStateAt(model, slot).player.arsenal))
        ? 0
        : 4,
    Heart: () => 0,
    Repair: () => 0,
    Trap: () => 1,
    Sight: () => 4,
  })

// NOTE: the shop opens on the row a player most likely wants, so Enter never
// lands first on a gun that would replace the one in their hands.
export const suggestedItem = (
  model: World,
  slot: PlayerSlot,
  category: ShopCategory,
): ShopItemId => {
  const stockRank = (id: ShopItemId): number =>
    StockTag.match(stockTag(model, slot, id), {
      Price: () => 0,
      Short: () => 1,
      Done: () => 2,
    })
  return pipe(
    itemsIn(model, slot, category),
    Array.sort(
      Order.combine(
        Order.mapInput(Order.Number, stockRank),
        Order.mapInput(Order.Number, (id: ShopItemId) =>
          suggestionRank(model, slot, id),
        ),
      ),
    ),
    Array.headNonEmpty,
  )
}

export { isHolding }

// PURCHASE

const refill = (
  arsenal: Arsenal,
  weapon: WeaponKind,
  rounds: number,
): Arsenal =>
  mapGuns(arsenal, gun =>
    gun.kind === weapon
      ? modifyFields(gun, {
          rounds: current =>
            Math.min(maxRounds(weapon, gun.tier), current + rounds),
        })
      : gun,
  )

// NOTE: an upgrade finds its gun in a gun slot or, for the Pan, in the
// melee slot.
const upgrade = (player: Player, weapon: WeaponKind): Player =>
  mapCarried(player, gun =>
    gun.kind === weapon ? modifyFields(gun, { tier: tier => tier + 1 }) : gun,
  )

const equip = (
  model: World,
  slot: PlayerSlot,
  toPlayer: (player: Player) => Player,
): World => modifySeat(model, slot, { player: toPlayer })

const grant = (model: World, slot: PlayerSlot, good: ShopGood): World =>
  ShopGood.match(good, {
    Gun: ({ weapon }) =>
      equip(model, slot, player =>
        modifyFields(putGunInHand(player), {
          arsenal: arsenal =>
            takeGun(arsenal, freshGun(weapon, player.calling)),
          wield: () => 'Gun',
        }),
      ),
    Ammo: ({ weapon, rounds }) =>
      equip(model, slot, player =>
        modifyFields(player, {
          arsenal: arsenal => refill(arsenal, weapon, rounds),
        }),
      ),
    Upgrade: ({ weapon }) =>
      equip(model, slot, player => upgrade(player, weapon)),
    Heart: () =>
      equip(model, slot, player =>
        modifyFields(player, { hp: hp => Math.min(maxHpOf(player), hp + 1) }),
      ),
    Trap: ({ kind }) => stockTrap(model, slot, kind),
    Repair: ({ trapId }) =>
      modifyFields(model, { traps: traps => repairTrap(traps, trapId) }),
    Sight: () => modifySeat(model, slot, { laserSight: () => 'Fitted' }),
  })

// NOTE: the World with `id` bought, or why Rattles turns it down.
export const tryPurchase = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): Result.Result<World, string> => {
  const item = shopItem(id)
  const price = priceFor(model, slot, id)
  return Verdict.match(verdictFor(model, slot, id), {
    Available: () =>
      Result.succeed(
        grant(
          modifyFields(model, {
            seats: atSeat(slot, { wallet: wallet => spend(wallet, price) }),
            stats: countPurchase,
          }),
          slot,
          item.good,
        ),
      ),
    Refused: ({ reason }) => Result.fail(reason),
  })
}

export const purchase = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): Option.Option<World> => Result.getSuccess(tryPurchase(model, slot, id))

// STALL

type StallBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

// NOTE: the stall stands in the parlour, where every run starts, and its
// sprites are baked once for that spot. Opening an exit adds rooms around
// the parlour without moving it.
const stallBox = (): StallBox => {
  const tiles = tilesWithSymbol(PARLOUR, SHOP_STALL_SYMBOL)
  const columns = Array.map(tiles, ({ column }) => column)
  const rows = Array.map(tiles, ({ row }) => row)
  return {
    left: Math.min(...columns) * TILE_SIZE,
    top: Math.min(...rows) * TILE_SIZE,
    right: (Math.max(...columns) + 1) * TILE_SIZE,
    bottom: (Math.max(...rows) + 1) * TILE_SIZE,
  }
}

export const STALL_BOX: StallBox = stallBox()

const distanceToStall = ({ x, y }: Vector): number =>
  Math.hypot(
    Math.max(STALL_BOX.left - x, 0, x - STALL_BOX.right),
    Math.max(STALL_BOX.top - y, 0, y - STALL_BOX.bottom),
  )

const isAtStall = (position: Vector): boolean =>
  distanceToStall(position) <= SHOP_REACH_PX

const hasLeftStall = (position: Vector): boolean =>
  distanceToStall(position) > SHOP_LEAVE_PX

export const isNearStall = (position: Vector): boolean =>
  distanceToStall(position) <= SHOP_NEAR_PX

export const isShopOpenFor = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation'])(phase) && phase.wave >= SHOP_FIRST_WAVE

export const isBrowsing = (shop: ShopState): boolean =>
  ShopState.isAnyOf(['Browsing'])(shop)

// NOTE: at the stall the player is out of the fight for a moment: the break
// clock stops and the game takes no input.
export const isAtCounter = (shop: ShopState): boolean =>
  ShopState.isAnyOf(['Browsing'])(shop)

const arriveAtStall = (model: World, slot: PlayerSlot): ShopState =>
  isShopOpenFor(model.phase)
    ? ShopState.Browsing({
        focusedItem: suggestedItem(
          model,
          slot,
          seatStateAt(model, slot).shopCategory,
        ),
      })
    : ShopState.Away()

// NOTE: walking into the stall opens the shop. It stays shut after it is
// left until the player steps away.
const arriveAt = (
  model: World,
  slot: PlayerSlot,
  shop: ShopState,
): ShopState =>
  isAtStall(seatStateAt(model, slot).player) ? arriveAtStall(model, slot) : shop

export const refreshShopPresence = (model: World, slot: PlayerSlot): World => {
  const { player } = seatStateAt(model, slot)
  return modifySeat(model, slot, {
    shop: shop =>
      ShopState.match(shop, {
        Away: () => arriveAt(model, slot, shop),
        Browsing: () => shop,
        Dismissed: () => (hasLeftStall(player) ? ShopState.Away() : shop),
      }),
  })
}

export type StallPrompt = 'None' | 'WalkUp' | 'ClosedUntilFirstClear'

// NOTE: mid-wave the stall is the ammo window (src/ammoCounter.ts), whose
// own sign and tag say what it sells, so it needs no words.
const closedPrompt = (phase: Phase): StallPrompt =>
  Phase.isAnyOf(['Wave'])(phase) ? 'None' : 'ClosedUntilFirstClear'

// NOTE: the words teach the stall once. After the player has shopped, its
// sign and the bobbing coin over it say the same without words.
export const stallPrompt = (model: World, slot: PlayerSlot): StallPrompt => {
  const { phase, lessons } = model
  const { player, shop } = seatStateAt(model, slot)
  if (
    !Phase.isAnyOf(['Preparation', 'Wave'])(phase) ||
    !isNearStall(player) ||
    Lesson.isAnyOf(['Learned'])(lessons.shop)
  ) {
    return 'None'
  } else if (!isShopOpenFor(phase)) {
    return closedPrompt(phase)
  } else if (ShopState.isAnyOf(['Away'])(shop) && !isAtStall(player)) {
    return 'WalkUp'
  } else {
    return 'None'
  }
}
