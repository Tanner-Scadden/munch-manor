import {
  Array,
  Function,
  Option,
  Order,
  Result,
  Schema,
  pipe,
} from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  MONEY_TICK_PER_SECOND,
  SHOP_FIRST_WAVE,
  SHOP_LEAVE_PX,
  SHOP_NEAR_PX,
  SHOP_REACH_PX,
  TILE_SIZE,
} from '../../shared/constants'
import {
  SIDEARM,
  UPGRADE_TIERS,
  WEAPONS,
  freshGun,
  isCarrying,
  isHolding,
  maxTier,
  maybeCarried,
  maybeReplacedGun,
  putGunInHand,
  takeGun,
  tierName,
  tierOf,
} from '../gear/weapons'
import { isPistolBarred, shopPriceFor } from '../heroes/calling'
import { PARLOUR, SHOP_STALL_SYMBOL, tilesWithSymbol } from '../level/arena'
import { SHOP_GOOD_NAMES } from '../names'
import { atSeat, modifySeat, seatStateAt } from '../party/party'
import { countPurchase } from '../run/stats'
import type { World } from '../schema/world'
import {
  type CarriedGun,
  Lesson,
  Phase,
  type Player,
  type PlayerSlot,
  type ShopCategory,
  ShopItemId,
  ShopState,
  type Vector,
  type Wallet,
  WeaponKind,
} from '../schema/worldSchema'

// MONEY

export { earn } from '../party/party'

const spend = (wallet: Wallet, amount: number): Wallet =>
  modifyFields(wallet, { balance: balance => balance - amount })

export const tickShownMoney: {
  (seconds: number): (wallet: Wallet) => Wallet
  (wallet: Wallet, seconds: number): Wallet
} = Function.dual(2, (wallet: Wallet, seconds: number): Wallet => {
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
})

// GOODS

export const ShopGood = defineTaggedUnion({
  Gun: { weapon: WeaponKind },
  Sight: {},
})
export type ShopGood = typeof ShopGood.Type

// NOTE: a gun's name as the player at `slot` reads it, with its tier word.
export const gunName: {
  (slot: PlayerSlot, weapon: WeaponKind): (model: World) => string
  (model: World, slot: PlayerSlot, weapon: WeaponKind): string
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, weapon: WeaponKind): string =>
    tierName(weapon, tierOf(seatStateAt(model, slot).player, weapon)),
)

type ShopItem = Readonly<{
  id: ShopItemId
  name: string
  blurb: string
  price: number
  good: ShopGood
}>

// NOTE: the sight is a luxury, so it is a late-run buy, and it is gone
// with the run.
export const LASER_SIGHT_PRICE = 400

export const SHOP_ITEMS: Readonly<Record<ShopItemId, ShopItem>> = {
  // NOTE: Rattles always sells the pistol back for nothing, so a player
  // who traded it away always has it to come back to.
  Pistol: {
    id: 'Pistol',
    name: WEAPONS.Pistol.name,
    blurb: 'Rattles gives it back for free.',
    price: 0,
    good: ShopGood.Gun({ weapon: 'Pistol' }),
  },
  Shotgun: {
    id: 'Shotgun',
    name: WEAPONS.Shotgun.name,
    blurb: 'Sprays seven pellets and shoves hard, but only up close.',
    price: 35,
    good: ShopGood.Gun({ weapon: 'Shotgun' }),
  },
  Smg: {
    id: 'Smg',
    name: WEAPONS.Smg.name,
    blurb: 'Fast and a little wobbly.',
    price: 100,
    good: ShopGood.Gun({ weapon: 'Smg' }),
  },
  LaserSight: {
    id: 'LaserSight',
    name: SHOP_GOOD_NAMES.LaserSight,
    blurb:
      'A red line on the floor shows where your shot goes. Fans out for a scattergun. Lasts the run.',
    price: LASER_SIGHT_PRICE,
    good: ShopGood.Sight(),
  },
}

export const shopItem = (id: ShopItemId): ShopItem => SHOP_ITEMS[id]

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
        'Two guns. A new one replaces the one in your hands, levels and all.',
    },
  }

export const SHOP_CATEGORY_ORDER: Array.NonEmptyReadonlyArray<ShopCategory> = [
  'Guns',
]

// GUNS

type GunLine = Readonly<{
  weapon: WeaponKind
  gun: ShopItemId
}>

// NOTE: a carried gun's line for a screen reader: its magazine, and its
// kills toward the next tier (src/world/gear/gunLevels.ts).
const levelStatus = (gun: CarriedGun): string =>
  Option.match(Array.get(UPGRADE_TIERS[gun.kind], gun.tier), {
    onNone: () => (maxTier(gun.kind) > 0 ? `${gun.kills} kills, top tier` : ''),
    onSome: next =>
      `${gun.kills} kills, ${next.kills - gun.kills} more to ${tierName(gun.kind, gun.tier + 1)}`,
  })

const roundsStatus = (gun: CarriedGun): string =>
  `${gun.loaded} loaded, ${WEAPONS[gun.kind].roundsLabel} never run out`

const panStatus = (pan: CarriedGun): string =>
  pan.loaded > 0
    ? `${pan.loaded} hits before it dents`
    : 'Dented, Rattles flattens it each break'

const statusOf = (gun: CarriedGun): string =>
  Array.join(
    Array.filter(
      [
        gun.kind === 'Pan' ? panStatus(gun) : roundsStatus(gun),
        levelStatus(gun),
      ],
      line => line !== '',
    ),
    '. ',
  )

// NOTE: the pistol, which Rattles always sells back.
const PISTOL_LINE: GunLine = { weapon: 'Pistol', gun: 'Pistol' }

// NOTE: the guns in display cases (src/world/feats/cases.ts), never sold
// (owner, 2026-11-10): a card only once carried, as a fridge weapon's.
const CASE_WEAPONS: ReadonlyArray<WeaponKind> = [
  'Shotgun',
  'Smg',
  'Rifle',
  'Blunderbuss',
]

// NOTE: a fridge weapon with tiers has a card only while a player carries
// it, with its tier and kills. Brain Freeze has no tiers, so it has none.
const LEVELED_FRIDGE_WEAPONS: ReadonlyArray<WeaponKind> = ['Cooker', 'Pan']

const ownedShelf = (gun: CarriedGun): GunShelf =>
  GunShelf.Owned({
    weapon: gun.kind,
    tier: gun.tier,
    status: statusOf(gun),
  })

const ownedShelves = (
  player: Player,
  weapons: ReadonlyArray<WeaponKind>,
): ReadonlyArray<GunShelf> =>
  Array.filterMap(weapons, weapon =>
    Option.match(maybeCarried(player, weapon), {
      onNone: () => Result.failVoid,
      onSome: gun => Result.succeed(ownedShelf(gun)),
    }),
  )

export const GunShelf = defineTaggedUnion({
  ForSale: { weapon: WeaponKind, item: ShopItemId },
  Owned: {
    weapon: WeaponKind,
    tier: Schema.Finite,
    status: Schema.String,
  },
})
export type GunShelf = typeof GunShelf.Type

const gunShelf = (player: Player, line: GunLine): GunShelf =>
  Option.match(maybeCarried(player, line.weapon), {
    onNone: () => GunShelf.ForSale({ weapon: line.weapon, item: line.gun }),
    onSome: ownedShelf,
  })

export const gunShelves: {
  (slot: PlayerSlot): (model: World) => Array.NonEmptyReadonlyArray<GunShelf>
  (model: World, slot: PlayerSlot): Array.NonEmptyReadonlyArray<GunShelf>
} = Function.dual(
  2,
  (model: World, slot: PlayerSlot): Array.NonEmptyReadonlyArray<GunShelf> =>
    Array.appendAll(
      Array.prepend(
        ownedShelves(seatStateAt(model, slot).player, CASE_WEAPONS),
        gunShelf(seatStateAt(model, slot).player, PISTOL_LINE),
      ),
      ownedShelves(seatStateAt(model, slot).player, LEVELED_FRIDGE_WEAPONS),
    ),
)

const shelfItems = (shelf: GunShelf): ReadonlyArray<ShopItemId> =>
  GunShelf.match(shelf, {
    ForSale: ({ item }) => [item],
    Owned: () => [],
  })

export const itemsIn: {
  (
    slot: PlayerSlot,
    category: ShopCategory,
  ): (model: World) => Array.NonEmptyReadonlyArray<ShopItemId>
  (
    model: World,
    slot: PlayerSlot,
    category: ShopCategory,
  ): Array.NonEmptyReadonlyArray<ShopItemId>
} = Function.dual(
  3,
  (
    model: World,
    slot: PlayerSlot,
    _category: ShopCategory,
  ): Array.NonEmptyReadonlyArray<ShopItemId> =>
    // NOTE: the Laser Sight's row stays, refused while it sits in a case,
    // so the Guns tab always has a row to focus once the pistol is carried.
    Array.append(
      Array.flatMap(gunShelves(model, slot), shelfItems),
      'LaserSight' as const,
    ),
)

// NOTE: a gun bought takes its row off the shelf, as its card shows it
// owned, so focus moves to the first row left on the Guns tab.
const replacementFor = (
  model: World,
  slot: PlayerSlot,
  item: ShopItemId,
): ShopItemId => {
  const shown = itemsIn(model, slot, seatStateAt(model, slot).shopCategory)
  return Array.contains(shown, item) ||
    !ShopGood.isAnyOf(['Gun'])(shopItem(item).good)
    ? item
    : Array.headNonEmpty(shown)
}

export const maybeDisplacedFocus: {
  (slot: PlayerSlot): (model: World) => Option.Option<ShopItemId>
  (model: World, slot: PlayerSlot): Option.Option<ShopItemId>
} = Function.dual(
  2,
  (model: World, slot: PlayerSlot): Option.Option<ShopItemId> =>
    ShopState.match(seatStateAt(model, slot).shop, {
      Away: () => Option.none(),
      Browsing: ({ focusedItem }) =>
        Option.liftPredicate(
          replacementFor(model, slot, focusedItem),
          replacement => replacement !== focusedItem,
        ),
      Dismissed: () => Option.none(),
    }),
)

// NOTE: what Rattles charges the acting player: the list price as the
// calling changes it (the Penny Pincher's discount). A price of nothing
// stays nothing.
export const priceFor: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => number
  (model: World, slot: PlayerSlot, id: ShopItemId): number
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, id: ShopItemId): number => {
    const { calling } = seatStateAt(model, slot).player
    return ShopGood.match(shopItem(id).good, {
      Gun: () => shopPriceFor(calling, shopItem(id).price),
      Sight: () => shopPriceFor(calling, shopItem(id).price),
    })
  },
)

export const itemName: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => string
  (model: World, slot: PlayerSlot, id: ShopItemId): string
} = Function.dual(
  3,
  (_model: World, _slot: PlayerSlot, id: ShopItemId): string =>
    ShopGood.match(shopItem(id).good, {
      Gun: () => shopItem(id).name,
      Sight: () => shopItem(id).name,
    }),
)

export const itemAriaLabel: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => string
  (model: World, slot: PlayerSlot, id: ShopItemId): string
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, id: ShopItemId): string => {
    const price = `$${priceFor(model, slot, id)}`
    return ShopGood.match(shopItem(id).good, {
      Gun: () => `Buy ${itemName(model, slot, id)} for ${price}`,
      Sight: () => `Buy ${itemName(model, slot, id)} for ${price}`,
    })
  },
)

export const itemBlurb: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => string
  (model: World, slot: PlayerSlot, id: ShopItemId): string
} = Function.dual(
  3,
  (_model: World, _slot: PlayerSlot, id: ShopItemId): string =>
    ShopGood.match(shopItem(id).good, {
      Gun: () => shopItem(id).blurb,
      Sight: () => shopItem(id).blurb,
    }),
)

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
      if (Array.contains(CASE_WEAPONS, weapon)) {
        return block('It sits in a display case', 'CASE')
      } else if (isCarrying(player, weapon)) {
        return block('You already carry it', 'OWNED')
      } else if (weapon === SIDEARM && isPistolBarred(player.calling)) {
        return block('Rattles will not sell you that', 'NO')
      } else {
        return Option.none()
      }
    },
    Sight: () =>
      seatStateAt(model, slot).laserSight === 'Fitted'
        ? block('Already fitted', 'OWNED')
        : block('It sits in a display case', 'CASE'),
  })
}

const blockedReason = (
  model: World,
  slot: PlayerSlot,
  good: ShopGood,
): Option.Option<string> =>
  Option.map(blockedBy(model, slot, good), ({ reason }) => reason)

export const verdictFor: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => Verdict
  (model: World, slot: PlayerSlot, id: ShopItemId): Verdict
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, id: ShopItemId): Verdict => {
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
  },
)

const isAvailable = (model: World, slot: PlayerSlot, id: ShopItemId): boolean =>
  Verdict.isAnyOf(['Available'])(verdictFor(model, slot, id))

export const affordableCount: {
  (slot: PlayerSlot, category: ShopCategory): (model: World) => number
  (model: World, slot: PlayerSlot, category: ShopCategory): number
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, category: ShopCategory): number =>
    Array.filter(itemsIn(model, slot, category), id =>
      isAvailable(model, slot, id),
    ).length,
)

export const totalAffordable: {
  (slot: PlayerSlot): (model: World) => number
  (model: World, slot: PlayerSlot): number
} = Function.dual(2, (model: World, slot: PlayerSlot): number =>
  Array.reduce(
    SHOP_CATEGORY_ORDER,
    0,
    (total, category) => total + affordableCount(model, slot, category),
  ),
)

// TAGS

export const StockTag = defineTaggedUnion({
  Price: { price: Schema.Finite },
  Short: { price: Schema.Finite, need: Schema.Finite },
  Done: { label: Schema.String },
})
export type StockTag = typeof StockTag.Type

export const stockTag: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => StockTag
  (model: World, slot: PlayerSlot, id: ShopItemId): StockTag
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, id: ShopItemId): StockTag => {
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
  },
)

// SUGGESTION

const suggestionRank = (
  model: World,
  slot: PlayerSlot,
  id: ShopItemId,
): number =>
  ShopGood.match(shopItem(id).good, {
    Gun: () =>
      Option.isNone(maybeReplacedGun(seatStateAt(model, slot).player.arsenal))
        ? 0
        : 4,
    Sight: () => 4,
  })

// NOTE: the shop opens on the row a player most likely wants, so Enter never
// lands first on a gun that would replace the one in their hands.
export const suggestedItem: {
  (slot: PlayerSlot, category: ShopCategory): (model: World) => ShopItemId
  (model: World, slot: PlayerSlot, category: ShopCategory): ShopItemId
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, category: ShopCategory): ShopItemId => {
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
  },
)

export { isHolding }

// PURCHASE

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
    Sight: () => modifySeat(model, slot, { laserSight: () => 'Fitted' }),
  })

// NOTE: the World with `id` bought, or why Rattles turns it down.
export const tryPurchase: {
  (
    slot: PlayerSlot,
    id: ShopItemId,
  ): (model: World) => Result.Result<World, string>
  (model: World, slot: PlayerSlot, id: ShopItemId): Result.Result<World, string>
} = Function.dual(
  3,
  (
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
  },
)

export const purchase: {
  (slot: PlayerSlot, id: ShopItemId): (model: World) => Option.Option<World>
  (model: World, slot: PlayerSlot, id: ShopItemId): Option.Option<World>
} = Function.dual(
  3,
  (model: World, slot: PlayerSlot, id: ShopItemId): Option.Option<World> =>
    Result.getSuccess(tryPurchase(model, slot, id)),
)

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

export const refreshShopPresence: {
  (slot: PlayerSlot): (model: World) => World
  (model: World, slot: PlayerSlot): World
} = Function.dual(2, (model: World, slot: PlayerSlot): World => {
  const { player } = seatStateAt(model, slot)
  return modifySeat(model, slot, {
    shop: shop =>
      ShopState.match(shop, {
        Away: () => arriveAt(model, slot, shop),
        Browsing: () => shop,
        Dismissed: () => (hasLeftStall(player) ? ShopState.Away() : shop),
      }),
  })
})

export type StallPrompt = 'None' | 'WalkUp' | 'ClosedUntilFirstClear'

// NOTE: mid-wave the stall is shut, its CLOSED sign says so, and the
// wave is no time for words.
const closedPrompt = (phase: Phase): StallPrompt =>
  Phase.isAnyOf(['Wave'])(phase) ? 'None' : 'ClosedUntilFirstClear'

// NOTE: the words teach the stall once. After the player has shopped, its
// sign and the bobbing coin over it say the same without words.
export const stallPrompt: {
  (slot: PlayerSlot): (model: World) => StallPrompt
  (model: World, slot: PlayerSlot): StallPrompt
} = Function.dual(2, (model: World, slot: PlayerSlot): StallPrompt => {
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
})
