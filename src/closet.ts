import { Array, Option, Record } from 'effect'

import {
  type Appearance,
  type Calling,
  GiftHat,
  HAT_GIFT_RANKS,
  HAT_PRICES,
  type Hat,
  type SavedBoughtHats,
  type SavedRank,
  SoldHat,
} from './playerData'
import { bonesBalanceOf } from './rank'

// The closet (GAME_DESIGN.md, "Rank and Bones"): the pure rules for hats.
// A gift hat is free at its rank and is owned by rank alone, so a rank up
// writes nothing. A sold hat is bought once with Bones and kept in the save.
// Nothing here reads the Model.

// NOTE: a hat that is something to wear: every hat but the bare head.
export type RealHat = Exclude<Hat, 'None'>

// NOTE: the closet's cards in order: the gifts by the rank that opens them,
// then the hats for sale by price.
export const CLOSET_HATS: Array.NonEmptyReadonlyArray<RealHat> = [
  ...GiftHat.literals,
  ...SoldHat.literals,
]

export type HatSource =
  | Readonly<{ kind: 'Gift'; rank: number }>
  | Readonly<{ kind: 'Sold'; price: number }>

const isGiftHat = (hat: RealHat): hat is GiftHat =>
  Array.contains(GiftHat.literals, hat)

export const hatSourceOf = (hat: RealHat): HatSource =>
  isGiftHat(hat)
    ? { kind: 'Gift', rank: HAT_GIFT_RANKS[hat] }
    : { kind: 'Sold', price: HAT_PRICES[hat] }

// NOTE: the price of a hat for sale, none for a gift.
export const priceOf = (hat: Hat): Option.Option<number> =>
  Record.get<string, number>(HAT_PRICES, hat)

const giftRankOf = (hat: Hat): Option.Option<number> =>
  Record.get<string, number>(HAT_GIFT_RANKS, hat)

// OWNING

export const isHatOwned = (
  hat: Hat,
  bought: SavedBoughtHats,
  rank: number,
): boolean =>
  hat === 'None' ||
  Option.match(giftRankOf(hat), {
    onNone: () => Array.contains(bought, hat),
    onSome: giftRank => rank >= giftRank,
  })

// NOTE: the look wearing a hat only if it is owned, else bare headed.
export const lookInOwnedHat = (
  look: Appearance,
  bought: SavedBoughtHats,
  rank: number,
): Appearance =>
  isHatOwned(look.hat, bought, rank) ? look : { ...look, hat: 'None' }

// NOTE: the gift hats a rank up from `rankBefore` to `rankAfter` opened,
// lowest rank first.
export const hatsGiftedBy = (
  rankBefore: number,
  rankAfter: number,
): ReadonlyArray<GiftHat> =>
  Array.filter(
    GiftHat.literals,
    hat => HAT_GIFT_RANKS[hat] > rankBefore && HAT_GIFT_RANKS[hat] <= rankAfter,
  )

// A CARD

export type HatStanding = 'Worn' | 'Owned' | 'ForSale' | 'Locked'

export const hatStandingOf = (
  hat: RealHat,
  worn: Hat,
  bought: SavedBoughtHats,
  rank: number,
): HatStanding =>
  worn === hat
    ? 'Worn'
    : isHatOwned(hat, bought, rank)
      ? 'Owned'
      : isGiftHat(hat)
        ? 'Locked'
        : 'ForSale'

// BUYING

const canAfford = (rank: SavedRank, hat: Hat): boolean =>
  Option.exists(priceOf(hat), price => bonesBalanceOf(rank) >= price)

// NOTE: what a tap on a card does, read from the standing: take a worn hat
// off, put an owned one on, buy and wear one for sale (or fail to, short of
// Bones), and nothing for a locked gift.
export type ClosetTap = 'TakeOff' | 'Wear' | 'Buy' | 'Short' | 'Nothing'

export const closetTapOf = (
  hat: RealHat,
  worn: Hat,
  bought: SavedBoughtHats,
  rank: SavedRank,
  rankNumber: number,
): ClosetTap => {
  const standing = hatStandingOf(hat, worn, bought, rankNumber)
  return standing === 'Worn'
    ? 'TakeOff'
    : standing === 'Owned'
      ? 'Wear'
      : standing === 'Locked'
        ? 'Nothing'
        : canAfford(rank, hat)
          ? 'Buy'
          : 'Short'
}

// NOTE: a calling's prop sits where the hat would, so the player wears the
// prop and not the hat; YOU has no prop and shows the hat.
export const shownHatOf = (look: Appearance, calling: Calling): Hat =>
  calling === 'You' ? look.hat : 'None'

// NOTE: the element id of a card, for focus.
export const closetCardId = (hat: Hat): string =>
  `closet-card-${hat.toLowerCase()}`

// NOTE: the card `step` places from another, wrapping at the ends.
export const steppedHat = (
  from: RealHat,
  step: number,
): Option.Option<RealHat> =>
  Option.flatMap(
    Array.findFirstIndex(CLOSET_HATS, hat => hat === from),
    index =>
      Array.get(
        CLOSET_HATS,
        (index + step + CLOSET_HATS.length) % CLOSET_HATS.length,
      ),
  )
