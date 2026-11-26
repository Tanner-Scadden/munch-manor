import { Array, Function, Option, Record } from 'effect'

import { PLAYER_MAX_HP } from '#shared/constants.ts'
import {
  COSMETIC_PRICES,
  Calling,
  type SavedBoughtCosmetics,
  type SavedRank,
  heroIdOf,
} from '#shared/playerData.ts'

import { bonesBalanceOf } from './rank.ts'

export const CALLINGS: Array.NonEmptyReadonlyArray<Calling> = Calling.literals

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

export const callingPriceOf = (calling: Calling): Option.Option<number> =>
  Record.get<string, number>(COSMETIC_PRICES, heroIdOf(calling))

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

export const canAffordCalling: {
  (calling: Calling): (rank: SavedRank) => boolean
  (rank: SavedRank, calling: Calling): boolean
} = Function.dual(2, (rank: SavedRank, calling: Calling): boolean =>
  Option.match(callingPriceOf(calling), {
    onNone: () => false,
    onSome: price => bonesBalanceOf(rank) >= price,
  }),
)

export const callingForRun: {
  (bought: SavedBoughtCosmetics): (chosen: Calling) => Calling
  (chosen: Calling, bought: SavedBoughtCosmetics): Calling
} = Function.dual(
  2,
  (chosen: Calling, bought: SavedBoughtCosmetics): Calling =>
    isCallingOwned(chosen, bought) ? chosen : 'You',
)

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

type Wearer = Readonly<{ calling: Calling }>

const HEARTS_LESS = 1

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

const HANDYMAN_TRAP_HEALTH_SCALE = 1.5
const HANDYMAN_MEND_SPEED = 2

export const trapHealthScaleOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? HANDYMAN_TRAP_HEALTH_SCALE : 1

export const mendSpeedScaleOf = ({ calling }: Wearer): number =>
  calling === 'Handyman' ? HANDYMAN_MEND_SPEED : 1

const TRACK_STAR_SPEED = 1.2

export const speedScaleOf = ({ calling }: Wearer): number =>
  calling === 'TrackStar' ? TRACK_STAR_SPEED : 1

const TRACK_STAR_MAGAZINE_PERCENT = 95

export const magazineFor: {
  (magazine: number): (calling: Calling) => number
  (calling: Calling, magazine: number): number
} = Function.dual(2, (calling: Calling, magazine: number): number =>
  calling === 'TrackStar'
    ? Math.max(1, Math.round((magazine * TRACK_STAR_MAGAZINE_PERCENT) / 100))
    : magazine,
)

export const stoveKillsFor: {
  (kills: number): (calling: Calling) => number
  (calling: Calling, kills: number): number
} = Function.dual(2, (calling: Calling, kills: number): number =>
  calling === 'LineCook' ? Math.ceil(kills / 2) : kills,
)

const PENNY_KEY_SCALE = 1.5

export const keyScaleOf = ({ calling }: Wearer): number =>
  calling === 'PennyPincher' ? PENNY_KEY_SCALE : 1

export const startsWithCooker = (calling: Calling): boolean =>
  calling === 'LineCook'

export const startingGunKind = (calling: Calling): 'Cooker' | 'Pistol' =>
  startsWithCooker(calling) ? 'Cooker' : 'Pistol'

export const isPistolBarred = (calling: Calling): boolean =>
  calling === 'LineCook'
