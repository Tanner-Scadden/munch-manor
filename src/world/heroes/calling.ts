import { Array, Function, Option, Record } from 'effect'

import { PLAYER_MAX_HP } from '../../shared/constants'
import {
  COSMETIC_PRICES,
  Calling,
  type SavedBoughtCosmetics,
  type SavedRank,
  heroIdOf,
} from '../../shared/playerData'
import { type Modifiers, brokenKillPay, noModifiers } from '../run/modifiers'
import { bonesBalanceOf } from './rank'

// NOTE: players read "hero" (plural "heroes") for what the code calls a
// calling, renamed 2026-11-01 by the owner. The code keeps `calling`, as
// `Character` already names the Look tab, so every word a player sees lives
// in src/world/names.ts and the views.

// Callings (GAME_DESIGN.md, "Rank and Bones"): what a player brings to a
// run, picked at home and unlocked by rank. YOU has no quirk. Every other
// calling is a trade-off, never a straight boost. These are the pure rules,
// each reading only a calling, so the co-op room plays them from each
// seat's own `calling` and single player from the World's. Nothing here
// reads the Model or a view.

export const CALLINGS: Array.NonEmptyReadonlyArray<Calling> = Calling.literals

// UNLOCKS

// NOTE: the rank each calling opens for sale at. A rank is derived from the
// points earned (src/world/heroes/rank.ts). A hero is then bought with Bones (its price is
// in COSMETIC_PRICES, src/shared/playerData.ts) and kept in the save's bought list.
export const UNLOCK_RANKS: Readonly<Record<Calling, number>> = {
  You: 1,
  Handyman: 3,
  TrackStar: 6,
  PennyPincher: 10,
  LineCook: 15,
}

export const isCallingUnlocked: {
  (rank: number): (calling: Calling) => boolean
  (calling: Calling, rank: number): boolean
} = Function.dual(
  2,
  (calling: Calling, rank: number): boolean => rank >= UNLOCK_RANKS[calling],
)

// OWNING

// NOTE: the Bones a hero costs, none for YOU.
export const callingPriceOf = (calling: Calling): Option.Option<number> =>
  Record.get<string, number>(COSMETIC_PRICES, heroIdOf(calling))

// NOTE: YOU is always owned; any other hero once bought.
export const isCallingOwned: {
  (bought: SavedBoughtCosmetics): (calling: Calling) => boolean
  (calling: Calling, bought: SavedBoughtCosmetics): boolean
} = Function.dual(
  2,
  (calling: Calling, bought: SavedBoughtCosmetics): boolean =>
    calling === 'You' || Array.contains(bought, heroIdOf(calling)),
)

export const ownedCallings = (
  bought: SavedBoughtCosmetics,
): ReadonlyArray<Calling> =>
  Array.filter(CALLINGS, calling => isCallingOwned(calling, bought))

// NOTE: a hero's card: owned (pickable), for sale (its rank is reached, so
// it shows its price and a pick tries it on), or locked (shows its rank).
export type CallingStanding = 'Owned' | 'ForSale' | 'Locked'

export const callingStandingOf: {
  (
    rank: number,
    bought: SavedBoughtCosmetics,
  ): (calling: Calling) => CallingStanding
  (
    calling: Calling,
    rank: number,
    bought: SavedBoughtCosmetics,
  ): CallingStanding
} = Function.dual(
  3,
  (
    calling: Calling,
    rank: number,
    bought: SavedBoughtCosmetics,
  ): CallingStanding =>
    isCallingOwned(calling, bought)
      ? 'Owned'
      : isCallingUnlocked(calling, rank)
        ? 'ForSale'
        : 'Locked',
)

// NOTE: whether the Bones cover a hero for sale.
export const canAffordCalling: {
  (calling: Calling): (rank: SavedRank) => boolean
  (rank: SavedRank, calling: Calling): boolean
} = Function.dual(2, (rank: SavedRank, calling: Calling): boolean =>
  Option.match(callingPriceOf(calling), {
    onNone: () => false,
    onSome: price => bonesBalanceOf(rank) >= price,
  }),
)

// NOTE: the calling a run starts with: the one picked if it is owned, else
// YOU. A synced pick this device has not bought (or an old save from when
// rank alone opened heroes) starts YOU.
export const callingForRun: {
  (bought: SavedBoughtCosmetics): (chosen: Calling) => Calling
  (chosen: Calling, bought: SavedBoughtCosmetics): Calling
} = Function.dual(
  2,
  (chosen: Calling, bought: SavedBoughtCosmetics): Calling =>
    isCallingOwned(chosen, bought) ? chosen : 'You',
)

// NOTE: the callings a rank up to `rank` opened that `before` had not.
export const callingsOpenedBy: {
  (rankAfter: number): (rankBefore: number) => ReadonlyArray<Calling>
  (rankBefore: number, rankAfter: number): ReadonlyArray<Calling>
} = Function.dual(
  2,
  (rankBefore: number, rankAfter: number): ReadonlyArray<Calling> =>
    Array.filter(
      CALLINGS,
      calling =>
        !isCallingUnlocked(calling, rankBefore) &&
        isCallingUnlocked(calling, rankAfter),
    ),
)

// HEARTS

type Wearer = Readonly<{ calling: Calling }>

// NOTE: the Handyman has one fewer heart. Every heal, the Sandwich prize,
// a revive, and the hearts drawn read this.
const HANDYMAN_HEARTS_LESS = 1

// NOTE: the hard hat: a bite leaves the Handyman twice as long to get clear.
// It pays back part of his fewer heart, which cost 8 points of wins to YOU
// on the balance bot with only cheap planks and free repairs to show for it.
const HANDYMAN_GRACE_SCALE = 2

export const woundGraceScaleOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? HANDYMAN_GRACE_SCALE : 1

export const maxHpOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? PLAYER_MAX_HP - HANDYMAN_HEARTS_LESS : PLAYER_MAX_HP

// SPEED

// NOTE: the Track Star runs 20% faster (10% left him 5 points under YOU, and
// with the dearer traps 15% was 9 under; 25% did no better on the bot).
const TRACK_STAR_SPEED = 1.2

export const speedScaleOf = ({ calling }: Wearer): number =>
  calling === 'TrackStar' ? TRACK_STAR_SPEED : 1

// MAGAZINES

// NOTE: the Track Star's magazines are 5% smaller, to the nearest round, never
// below one round. (20% lost 11 points of wins to YOU on the balance bot,
// 10% (rounded down) left him 8 under, and 5% rounded down 9; 5% to the nearest read 4 under.)
const TRACK_STAR_MAGAZINE_PERCENT = 95

export const magazineFor: {
  (magazine: number): (calling: Calling) => number
  (calling: Calling, magazine: number): number
} = Function.dual(2, (calling: Calling, magazine: number): number =>
  calling === 'TrackStar'
    ? Math.max(1, Math.round((magazine * TRACK_STAR_MAGAZINE_PERCENT) / 100))
    : magazine,
)

// PRICES

const PENNY_PRICE_PERCENT = 85

// NOTE: Rattles charges the Penny Pincher 15% less, rounded to the nearest
// dollar and never to nothing, except a price that was nothing already.
export const shopPriceFor: {
  (price: number): (calling: Calling) => number
  (calling: Calling, price: number): number
} = Function.dual(2, (calling: Calling, price: number): number =>
  calling === 'PennyPincher' && price > 0
    ? Math.max(1, Math.round((price * PENNY_PRICE_PERCENT) / 100))
    : price,
)

// NOTE: a Plank Pile costs the Handyman half, and he mends boards for
// nothing: the Handyman's one fewer heart cost 12 points of wins to YOU on
// the balance bot, which half price planks alone did not pay back.
export const isRepairFree = (calling: Calling): boolean =>
  calling === 'Handyman'

// NOTE: a Plank Pile costs the Handyman half.
export const plankPriceFor: {
  (price: number): (calling: Calling) => number
  (calling: Calling, price: number): number
} = Function.dual(2, (calling: Calling, price: number): number =>
  calling === 'Handyman' ? Math.round(price / 2) : price,
)

// NOTE: the stove (src/world/kitchen/stove.ts) cooks for the Line Cook at 25%
// off, rounded to the nearest dollar. It took the place of his smaller
// starting lid stack when ammo went endless (docs/ESCAPE_PLAN.md, "Endless
// ammo"); not tuned on the balance bot yet.
const COOK_STOVE_PERCENT = 75

export const stovePriceFor: {
  (price: number): (calling: Calling) => number
  (calling: Calling, price: number): number
} = Function.dual(2, (calling: Calling, price: number): number =>
  calling === 'LineCook'
    ? Math.round((price * COOK_STOVE_PERCENT) / 100)
    : price,
)

// KILL PAY

// NOTE: a kill pays the Penny Pincher 20% less, rounded to the nearest
// dollar, and never to nothing. Kills pay only $2 to $20, so rounding does
// the real work: a Shambler's $2 stays $2, a $3 kill pays $2, a Tank's $20
// pays $16, about 10% less over a run (a flat 15% rounded down cost a third
// of the income, and the Penny Pincher won 9 points fewer than YOU).
const PENNY_KILL_PERCENT = 80
export const killPayFor: {
  (pay: number, modifiers?: Modifiers): (calling: Calling) => number
  (calling: Calling, pay: number, modifiers?: Modifiers): number
} = Function.dual(
  // NOTE: data-first has the pay second; data-last has the modifiers there or nothing.
  (args: IArguments): boolean => typeof args[1] === 'number',
  (
    calling: Calling,
    pay: number,
    modifiers: Modifiers = noModifiers,
  ): number => {
    const broken = brokenKillPay(modifiers, pay)
    return calling === 'PennyPincher' && broken > 0
      ? Math.max(1, Math.round((broken * PENNY_KILL_PERCENT) / 100))
      : broken
  },
)

// THE STARTING GUN

export const startsWithCooker = (calling: Calling): boolean =>
  calling === 'LineCook'

// NOTE: the gun a calling starts holding, for the Profile's Look preview.
export const startingGunKind = (calling: Calling): 'Cooker' | 'Pistol' =>
  startsWithCooker(calling) ? 'Cooker' : 'Pistol'

// NOTE: Rattles never sells the Line Cook the Pop Pistol back.
export const isPistolBarred = (calling: Calling): boolean =>
  calling === 'LineCook'
