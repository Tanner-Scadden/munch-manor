import { Array, Function, Option, Record } from 'effect'

import { PLAYER_MAX_HP } from '../../shared/constants'
import {
  COSMETIC_PRICES,
  Calling,
  type SavedBoughtCosmetics,
  type SavedRank,
  heroIdOf,
} from '../../shared/playerData'
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

// NOTE: the Handyman and the Penny Pincher have one fewer heart. Every
// heal, the Sandwich prize, a revive, and the hearts drawn read this.
const HEARTS_LESS = 1

// NOTE: the hard hat: a bite leaves the Handyman twice as long to get clear.
// It pays back part of his fewer heart, which cost 8 points of wins to YOU
// on the balance bot with only cheap planks and free repairs to show for it
// (before traps were found in the house, docs/ESCAPE_PLAN.md layer 6).
const HANDYMAN_GRACE_SCALE = 2

export const woundGraceScaleOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? HANDYMAN_GRACE_SCALE : 1

export const maxHpOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' || calling === 'PennyPincher'
    ? PLAYER_MAX_HP - HEARTS_LESS
    : PLAYER_MAX_HP

export const isMissingHeart = (
  player: Wearer & Readonly<{ hp: number }>,
): boolean => player.hp < maxHpOf(player)

// TRAPS

// NOTE: traps are found, not bought, and mend for free (src/world/gear/
// crates.ts, src/world/gear/traps.ts), so the Handyman's half-price planks
// and free repairs became this: a trap he sets down has half again the
// health, and he mends traps twice as fast. Not yet retuned on the balance
// bot (docs/ESCAPE_PLAN.md, layer 17).
const HANDYMAN_TRAP_HEALTH_SCALE = 1.5
const HANDYMAN_MEND_SPEED = 2

export const trapHealthScaleOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? HANDYMAN_TRAP_HEALTH_SCALE : 1

export const mendSpeedScaleOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? HANDYMAN_MEND_SPEED : 1

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

// THE STOVE

// NOTE: the stove (src/world/kitchen/stove.ts) lights for the Line Cook
// after half the kitchen kills, rounded up: he knows his way round a
// kitchen. It took the place of his smaller starting lid stack when ammo
// went endless (docs/ESCAPE_PLAN.md, "The stove and the valve"); not tuned
// on the balance bot yet.
export const stoveKillsFor: {
  (kills: number): (calling: Calling) => number
  (calling: Calling, kills: number): number
} = Function.dual(2, (calling: Calling, kills: number): number =>
  calling === 'LineCook' ? Math.ceil(kills / 2) : kills,
)

// KEYS

// NOTE: zombies drop half again as many keys for the Penny Pincher's kills
// (src/world/keys/keys.ts): she has an eye for loose change, paid for with
// one fewer heart. Starting points from docs/ESCAPE_PLAN.md, not tuned on
// the balance bot yet (layer 17).
const PENNY_KEY_SCALE = 1.5

export const keyScaleOf = ({ calling }: Wearer): number =>
  calling === 'PennyPincher' ? PENNY_KEY_SCALE : 1

// THE STARTING GUN

export const startsWithCooker = (calling: Calling): boolean =>
  calling === 'LineCook'

// NOTE: the gun a calling starts holding, for the Profile's Look preview.
export const startingGunKind = (calling: Calling): 'Cooker' | 'Pistol' =>
  startsWithCooker(calling) ? 'Cooker' : 'Pistol'

// NOTE: Rattles never sells the Line Cook the Pop Pistol back.
export const isPistolBarred = (calling: Calling): boolean =>
  calling === 'LineCook'
