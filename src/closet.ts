import { Array, Option, Order, Record } from 'effect'

import {
  type Appearance,
  COSMETIC_GIFT_RANKS,
  COSMETIC_PRICES,
  type Calling,
  type CosmeticKind,
  GiftGunSkin,
  GiftHat,
  GiftPrint,
  GiftShirtColor,
  type Hat,
  type SavedBoughtCosmetics,
  type SavedRank,
  cosmeticIdOf,
} from './playerData'
import { bonesBalanceOf } from './rank'

// The closet (GAME_DESIGN.md, "Rank and Bones"): the pure rules for the
// earned looks, hats, shirt colors, prints, and gun skins, which the Look
// tab's rows show. A gift is free at its rank and owned by rank alone, so a
// rank up writes nothing. A sold look is bought once with Bones and kept in
// the save. Anything with neither a rank nor a price is free. Nothing here
// reads the Model.

// SOURCES

export type LookSource =
  | Readonly<{ kind: 'Free' }>
  | Readonly<{ kind: 'Gift'; rank: number }>
  | Readonly<{ kind: 'Sold'; price: number }>

// NOTE: where a look comes from, by its kind and name (`Hat`, `Fez`).
export const sourceOf = (kind: CosmeticKind, name: string): LookSource => {
  const id = cosmeticIdOf(kind, name)
  return Option.match(Record.get<string, number>(COSMETIC_GIFT_RANKS, id), {
    onSome: rank => ({ kind: 'Gift', rank }),
    onNone: () =>
      Option.match(Record.get<string, number>(COSMETIC_PRICES, id), {
        onSome: price => ({ kind: 'Sold', price }),
        onNone: () => ({ kind: 'Free' }),
      }),
  })
}

// OWNING

export const isOwned = (
  kind: CosmeticKind,
  name: string,
  bought: SavedBoughtCosmetics,
  rank: number,
): boolean => {
  const source = sourceOf(kind, name)
  return source.kind === 'Free'
    ? true
    : source.kind === 'Gift'
      ? rank >= source.rank
      : Array.contains(bought, cosmeticIdOf(kind, name))
}

// NOTE: the look wearing only what the player owns: a hat, shirt color,
// print, or gun skin that is not owned (a purchase another device's Bones
// outran) goes back to bare headed, blue, plain, and stock. The same look
// comes back when nothing is off.
export const lookInOwned = (
  look: Appearance,
  bought: SavedBoughtCosmetics,
  rank: number,
): Appearance => {
  const hat = isOwned('Hat', look.hat, bought, rank) ? look.hat : 'None'
  const shirtColor = isOwned('Shirt', look.shirtColor, bought, rank)
    ? look.shirtColor
    : 'Blue'
  const print = isOwned('Print', look.print, bought, rank)
    ? look.print
    : 'Plain'
  const gunSkin = isOwned('Skin', look.gunSkin, bought, rank)
    ? look.gunSkin
    : 'Stock'
  return hat === look.hat &&
    shirtColor === look.shirtColor &&
    print === look.print &&
    gunSkin === look.gunSkin
    ? look
    : { ...look, hat, shirtColor, print, gunSkin }
}

// GIFTS

export type Gift = Readonly<{ kind: CosmeticKind; name: string; rank: number }>

const giftsOf = (
  kind: CosmeticKind,
  names: ReadonlyArray<string>,
): ReadonlyArray<Gift> =>
  Array.flatMap(names, name => {
    const source = sourceOf(kind, name)
    return source.kind === 'Gift' ? [{ kind, name, rank: source.rank }] : []
  })

// NOTE: every gift, lowest rank first.
export const GIFTS: ReadonlyArray<Gift> = Array.sort(
  [
    ...giftsOf('Hat', GiftHat.literals),
    ...giftsOf('Shirt', GiftShirtColor.literals),
    ...giftsOf('Print', GiftPrint.literals),
    ...giftsOf('Skin', GiftGunSkin.literals),
  ],
  Order.mapInput(Order.Number, (gift: Gift) => gift.rank),
)

// NOTE: the gifts a rank up from `rankBefore` to `rankAfter` opened, lowest
// rank first.
export const giftsOpenedBy = (
  rankBefore: number,
  rankAfter: number,
): ReadonlyArray<Gift> =>
  Array.filter(GIFTS, ({ rank }) => rank > rankBefore && rank <= rankAfter)

// A LOOK'S STANDING

export type Standing = 'Worn' | 'Owned' | 'ForSale' | 'Locked'

export const standingOf = (
  kind: CosmeticKind,
  name: string,
  worn: string,
  bought: SavedBoughtCosmetics,
  rank: number,
): Standing =>
  worn === name
    ? 'Worn'
    : isOwned(kind, name, bought, rank)
      ? 'Owned'
      : sourceOf(kind, name).kind === 'Gift'
        ? 'Locked'
        : 'ForSale'

// BUYING

const canAfford = (
  rank: SavedRank,
  kind: CosmeticKind,
  name: string,
): boolean => {
  const source = sourceOf(kind, name)
  return source.kind === 'Sold' && bonesBalanceOf(rank) >= source.price
}

// NOTE: what picking a look does, read from its standing: nothing for the
// one worn, put on one owned, buy and wear one for sale (or fail to, short of
// Bones), and nothing for a locked gift. Short and Locked leave the selection
// where it was.
export type GearTap = 'Stay' | 'Wear' | 'Buy' | 'Short' | 'Locked'

export const gearTapOf = (
  kind: CosmeticKind,
  name: string,
  worn: string,
  bought: SavedBoughtCosmetics,
  rank: SavedRank,
  rankNumber: number,
): GearTap => {
  const standing = standingOf(kind, name, worn, bought, rankNumber)
  return standing === 'Worn'
    ? 'Stay'
    : standing === 'Owned'
      ? 'Wear'
      : standing === 'Locked'
        ? 'Locked'
        : canAfford(rank, kind, name)
          ? 'Buy'
          : 'Short'
}

// NOTE: the price of a look for sale, none for any other.
export const priceOf = (
  kind: CosmeticKind,
  name: string,
): Option.Option<number> => {
  const source = sourceOf(kind, name)
  return source.kind === 'Sold' ? Option.some(source.price) : Option.none()
}

// NOTE: a calling's prop sits where the hat would, so the player wears the
// prop and not the hat; YOU has no prop and shows the hat.
export const shownHatOf = (look: Appearance, calling: Calling): Hat =>
  calling === 'You' ? look.hat : 'None'
