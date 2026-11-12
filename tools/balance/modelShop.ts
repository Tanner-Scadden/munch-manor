import { Array, Function, Option, type Record, pipe } from 'effect'

import { TRAPS } from '../../src/world/gear/traps'
import { EXIT_RULES } from '../../src/world/level/exits'
import type { SpareGun } from './modelGuns'

// THE PRICES, IN KEYS

export type Catalog = Readonly<{
  gunPrice: Readonly<Record<SpareGun, number>>
  plankPrice: number
  plankLimit: number
  gnomePrice: number
  gnomeLimit: number
  kitchenPrice: number
}>

// NOTE: the shop is gone (docs/ESCAPE_PLAN.md, layer 7). Guns sit in display
// cases opened by feats, so the model never buys one: their price is out of
// reach, and the Chatterbox comes from a case at `caseGunWave` (economy).
// The kitchen's padlock asks its keys.
export const CATALOG: Catalog = {
  gunPrice: {
    Shotgun: globalThis.Number.POSITIVE_INFINITY,
    Smg: globalThis.Number.POSITIVE_INFINITY,
  },
  // NOTE: traps are found in the trap crates (src/world/gear/crates.ts),
  // not bought, so the model gets them for nothing. It still picks them up
  // in its own order, one a visit, about as a crate gives one a break.
  plankPrice: 0,
  plankLimit: TRAPS.Barricade.limit,
  gnomePrice: 0,
  gnomeLimit: TRAPS.Turret.limit,
  kitchenPrice: EXIT_RULES.kitchenKeys,
}

// NOTE: a gun's tier is earned by its kills (src/world/gear/gunLevels.ts),
// so each gun carries its kills: the model kills every zombie of a wave
// with the gun it holds.
type Spare = Readonly<{ kind: SpareGun; tier: number; kills: number }>

export type Loadout = Readonly<{
  maybeSpare: Option.Option<Spare>
  pistolTier: number
  pistolKills: number
  gnomes: number
  planks: number
  hasKitchen: boolean
}>

export const STARTING_LOADOUT: Loadout = {
  maybeSpare: Option.none(),
  pistolTier: 0,
  pistolKills: 0,
  gnomes: 0,
  planks: 0,
  hasKitchen: false,
}

export type Purchase =
  | 'Shotgun'
  | 'Smg'
  | 'Plank'
  | 'Upkeep'
  | 'Gnome'
  | 'Kitchen'

type Basket = Readonly<{
  money: number
  loadout: Loadout
  bought: ReadonlyArray<Purchase>
}>

const priceOf = (
  catalog: Catalog,
  purchase: Purchase,
  upkeep: number,
): Option.Option<number> => {
  if (purchase === 'Shotgun' || purchase === 'Smg') {
    return Option.some(catalog.gunPrice[purchase])
  } else if (purchase === 'Plank') {
    return Option.some(catalog.plankPrice)
  } else if (purchase === 'Upkeep') {
    return Option.some(upkeep)
  } else if (purchase === 'Gnome') {
    return Option.some(catalog.gnomePrice)
  } else {
    return Option.some(catalog.kitchenPrice)
  }
}

export const withPurchase: {
  (purchase: Purchase): (loadout: Loadout) => Loadout
  (loadout: Loadout, purchase: Purchase): Loadout
} = Function.dual(2, (loadout: Loadout, purchase: Purchase): Loadout => {
  if (purchase === 'Shotgun' || purchase === 'Smg') {
    return {
      ...loadout,
      maybeSpare: Option.some({ kind: purchase, tier: 0, kills: 0 }),
    }
  } else if (purchase === 'Plank') {
    return { ...loadout, planks: loadout.planks + 1 }
  } else if (purchase === 'Gnome') {
    return { ...loadout, gnomes: loadout.gnomes + 1 }
  } else if (purchase === 'Kitchen') {
    return { ...loadout, hasKitchen: true }
  } else {
    return loadout
  }
})

// NOTE: the bot's shopping list in tools/balance/bot.ts, without hearts:
// the SMG once it can, else the shotgun; two planks; upkeep for repairs; a
// gnome; the kitchen; then a second gnome while a reserve stays. Tiers
// come from kills, not the shop (withKills).
const wantedNext = (
  catalog: Catalog,
  basket: Basket,
  upkeep: number,
  reserve: number,
): Option.Option<Purchase> => {
  const { loadout, money, bought } = basket
  const affords = (purchase: Purchase, keep: number) =>
    Option.match(priceOf(catalog, purchase, upkeep), {
      onNone: () => false,
      onSome: price => money - price >= keep,
    })
  const once = (purchase: Purchase) => !Array.contains(bought, purchase)
  return Option.match(loadout.maybeSpare, {
    onNone: () =>
      affords('Smg', 0)
        ? Option.some<Purchase>('Smg')
        : affords('Shotgun', 0)
          ? Option.some<Purchase>('Shotgun')
          : Option.none(),
    onSome: spare => {
      const candidates: ReadonlyArray<[Purchase, boolean]> = [
        [
          'Smg',
          spare.kind === 'Shotgun' && spare.tier === 0 && affords('Smg', 0),
        ],
        ['Plank', loadout.planks < catalog.plankLimit && affords('Plank', 0)],
        [
          'Upkeep',
          once('Upkeep') &&
            upkeep > 0 &&
            loadout.planks + loadout.gnomes > 0 &&
            affords('Upkeep', 0),
        ],
        ['Gnome', loadout.gnomes < 1 && affords('Gnome', reserve)],
        [
          'Kitchen',
          !loadout.hasKitchen &&
            spare.kind === 'Smg' &&
            spare.tier >= 2 &&
            loadout.gnomes >= 1 &&
            loadout.planks >= catalog.plankLimit &&
            affords('Kitchen', reserve),
        ],
        [
          'Gnome',
          loadout.gnomes < catalog.gnomeLimit &&
            spare.tier >= 2 &&
            affords('Gnome', reserve),
        ],
      ]
      return pipe(
        candidates,
        Array.findFirst(([, isWanted]) => isWanted),
        Option.map(([purchase]) => purchase),
      )
    },
  })
}

const MAX_PURCHASES_A_VISIT = 20

export type Visit = Readonly<{
  moneyOnArrival: number
  bought: ReadonlyArray<Purchase>
  spent: number
  moneyAfter: number
  loadout: Loadout
}>

// One shop visit: buy what the list wants until nothing more is wanted.
export const shopVisit: {
  (
    money: number,
    loadout: Loadout,
    upkeep: number,
    reserve: number,
  ): (catalog: Catalog) => Visit
  (
    catalog: Catalog,
    money: number,
    loadout: Loadout,
    upkeep: number,
    reserve: number,
  ): Visit
} = Function.dual(
  5,
  (
    catalog: Catalog,
    money: number,
    loadout: Loadout,
    upkeep: number,
    reserve: number,
  ): Visit => {
    const basket = Array.reduce(
      Array.makeBy(MAX_PURCHASES_A_VISIT, index => index),
      { money, loadout, bought: [] } satisfies Basket,
      (current: Basket): Basket =>
        Option.match(wantedNext(catalog, current, upkeep, reserve), {
          onNone: () => current,
          onSome: purchase => ({
            money:
              current.money -
              Option.getOrElse(priceOf(catalog, purchase, upkeep), () => 0),
            loadout: withPurchase(current.loadout, purchase),
            bought: Array.append(current.bought, purchase),
          }),
        }),
    )
    return {
      moneyOnArrival: money,
      bought: basket.bought,
      spent: money - basket.money,
      moneyAfter: basket.money,
      loadout: basket.loadout,
    }
  },
)
