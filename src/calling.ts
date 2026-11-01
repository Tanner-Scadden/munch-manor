import { Array } from 'effect'

import { PLAYER_MAX_HP } from './constants'
import { Calling } from './playerData'

// Callings (GAME_DESIGN.md, "Rank and Bones"): what a player brings to a
// run, picked at home and unlocked by rank. YOU has no quirk. Every other
// calling is a trade-off, never a straight boost. These are the pure rules,
// each reading only a calling, so the co-op room plays them from each
// seat's own `calling` and single player from the World's. Nothing here
// reads the Model or a view.

export const CALLINGS: Array.NonEmptyReadonlyArray<Calling> = Calling.literals

// UNLOCKS

// NOTE: the rank each calling opens at. A rank is derived from the points
// earned (src/rank.ts), so a synced save can say a calling it has not
// reached, and `callingForRun` starts YOU for it.
export const UNLOCK_RANKS: Readonly<Record<Calling, number>> = {
  You: 1,
  Handyman: 3,
  TrackStar: 6,
  PennyPincher: 10,
  LineCook: 15,
}

export const isCallingUnlocked = (calling: Calling, rank: number): boolean =>
  rank >= UNLOCK_RANKS[calling]

// NOTE: the calling a run starts with: the one picked if its rank is
// reached, else YOU.
export const callingForRun = (chosen: Calling, rank: number): Calling =>
  isCallingUnlocked(chosen, rank) ? chosen : 'You'

// NOTE: the callings a rank up to `rank` opened that `before` had not.
export const callingsOpenedBy = (
  rankBefore: number,
  rankAfter: number,
): ReadonlyArray<Calling> =>
  Array.filter(
    CALLINGS,
    calling =>
      !isCallingUnlocked(calling, rankBefore) &&
      isCallingUnlocked(calling, rankAfter),
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
// with the dearer traps 15% was 9 under).
const TRACK_STAR_SPEED = 1.2

export const speedScaleOf = ({ calling }: Wearer): number =>
  calling === 'TrackStar' ? TRACK_STAR_SPEED : 1

// MAGAZINES

// NOTE: the Track Star's magazines are 10% smaller, rounded down, never
// below one round. (20% lost 11 points of wins to YOU on the balance bot,
// so 10%.)
const TRACK_STAR_MAGAZINE_PERCENT = 90

export const magazineFor = (calling: Calling, magazine: number): number =>
  calling === 'TrackStar'
    ? Math.max(1, Math.floor((magazine * TRACK_STAR_MAGAZINE_PERCENT) / 100))
    : magazine

// PRICES

const PENNY_PRICE_PERCENT = 85

// NOTE: Rattles charges the Penny Pincher 15% less, rounded to the nearest
// dollar and never to nothing, except a price that was nothing already.
export const shopPriceFor = (calling: Calling, price: number): number =>
  calling === 'PennyPincher' && price > 0
    ? Math.max(1, Math.round((price * PENNY_PRICE_PERCENT) / 100))
    : price

// NOTE: a Plank Pile costs the Handyman half, and he mends boards for
// nothing: the Handyman's one fewer heart cost 12 points of wins to YOU on
// the balance bot, which half price planks alone did not pay back.
export const isRepairFree = (calling: Calling): boolean =>
  calling === 'Handyman'

// NOTE: a Plank Pile costs the Handyman half.
export const plankPriceFor = (calling: Calling, price: number): number =>
  calling === 'Handyman' ? Math.round(price / 2) : price

// KILL PAY

// NOTE: a kill pays the Penny Pincher 20% less, rounded to the nearest
// dollar, and never to nothing. Kills pay only $2 to $20, so rounding does
// the real work: a Shambler's $2 stays $2, a $3 kill pays $2, a Tank's $20
// pays $16, about 10% less over a run (a flat 15% rounded down cost a third
// of the income, and the Penny Pincher won 9 points fewer than YOU).
const PENNY_KILL_PERCENT = 80
export const killPayFor = (calling: Calling, pay: number): number =>
  calling === 'PennyPincher' && pay > 0
    ? Math.max(1, Math.round((pay * PENNY_KILL_PERCENT) / 100))
    : pay

// THE STARTING GUN

// NOTE: the lids the Line Cook starts with, fewer than a fridge's Cooker
// brings (20), set by the balance bot: with all 20 the bot won 42 of 100
// Normal campaigns, 12 points over YOU. 8 lids with $20 and 10 with $15
// died on waves 2 to 4 more (45% of runs) with no fewer wins; 14 died less
// (39%).
export const COOK_STARTING_LIDS = 14

export const startsWithCooker = (calling: Calling): boolean =>
  calling === 'LineCook'

// NOTE: the gun a calling starts holding, for the Profile's Look preview.
export const startingGunKind = (calling: Calling): 'Cooker' | 'Pistol' =>
  startsWithCooker(calling) ? 'Cooker' : 'Pistol'

// NOTE: Rattles never sells the Line Cook the Pop Pistol back.
export const isPistolBarred = (calling: Calling): boolean =>
  calling === 'LineCook'
