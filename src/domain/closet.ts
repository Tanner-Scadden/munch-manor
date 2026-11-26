import { Array, Function, Option, Order, Record } from 'effect'

import {
  type Appearance,
  COSMETIC_GIFT_RANKS,
  COSMETIC_PRICES,
  type CosmeticKind,
  GiftGunSkin,
  GiftHat,
  GiftPrint,
  GiftShirtColor,
  type SavedBoughtCosmetics,
  type SavedRank,
  cosmeticIdOf,
} from '#shared/records/playerData.ts'
import { bonesBalanceOf } from '#world/heroes/rank.ts'

export type LookSource =
  | Readonly<{ kind: 'Free' }>
  | Readonly<{ kind: 'Gift'; rank: number }>
  | Readonly<{ kind: 'Sold'; price: number }>

export const sourceOf: {
  (name: string): (kind: CosmeticKind) => LookSource
  (kind: CosmeticKind, name: string): LookSource
} = Function.dual(2, (kind: CosmeticKind, name: string): LookSource => {
  const id = cosmeticIdOf(kind, name)
  return Option.match(Record.get<string, number>(COSMETIC_GIFT_RANKS, id), {
    onSome: rank => ({ kind: 'Gift', rank }),
    onNone: () =>
      Option.match(Record.get<string, number>(COSMETIC_PRICES, id), {
        onSome: price => ({ kind: 'Sold', price }),
        onNone: () => ({ kind: 'Free' }),
      }),
  })
})

export const isOwned: {
  (
    name: string,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): (kind: CosmeticKind) => boolean
  (
    kind: CosmeticKind,
    name: string,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): boolean
} = Function.dual(
  4,
  (
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
  },
)

export const lookInOwned: {
  (bought: SavedBoughtCosmetics, rank: number): (look: Appearance) => Appearance
  (look: Appearance, bought: SavedBoughtCosmetics, rank: number): Appearance
} = Function.dual(
  3,
  (
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
  },
)

export type Gift = Readonly<{ kind: CosmeticKind; name: string; rank: number }>

const giftsOf = (
  kind: CosmeticKind,
  names: ReadonlyArray<string>,
): ReadonlyArray<Gift> =>
  Array.flatMap(names, name => {
    const source = sourceOf(kind, name)
    return source.kind === 'Gift' ? [{ kind, name, rank: source.rank }] : []
  })

export const GIFTS: ReadonlyArray<Gift> = Array.sort(
  [
    ...giftsOf('Hat', GiftHat.literals),
    ...giftsOf('Shirt', GiftShirtColor.literals),
    ...giftsOf('Print', GiftPrint.literals),
    ...giftsOf('Skin', GiftGunSkin.literals),
  ],
  Order.mapInput(Order.Number, (gift: Gift) => gift.rank),
)

export const giftsOpenedBy: {
  (rankAfter: number): (rankBefore: number) => ReadonlyArray<Gift>
  (rankBefore: number, rankAfter: number): ReadonlyArray<Gift>
} = Function.dual(
  2,
  (rankBefore: number, rankAfter: number): ReadonlyArray<Gift> =>
    Array.filter(GIFTS, ({ rank }) => rank > rankBefore && rank <= rankAfter),
)

export type Standing = 'Worn' | 'Owned' | 'ForSale' | 'Locked'

export const standingOf: {
  (
    name: string,
    worn: string,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): (kind: CosmeticKind) => Standing
  (
    kind: CosmeticKind,
    name: string,
    worn: string,
    bought: SavedBoughtCosmetics,
    rank: number,
  ): Standing
} = Function.dual(
  5,
  (
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
          : 'ForSale',
)

export const canAfford: {
  (kind: CosmeticKind, name: string): (rank: SavedRank) => boolean
  (rank: SavedRank, kind: CosmeticKind, name: string): boolean
} = Function.dual(
  3,
  (rank: SavedRank, kind: CosmeticKind, name: string): boolean => {
    const source = sourceOf(kind, name)
    return source.kind === 'Sold' && bonesBalanceOf(rank) >= source.price
  },
)

export type GearTap = 'Stay' | 'Wear' | 'Preview' | 'Locked'

export const gearTapOf: {
  (
    name: string,
    worn: string,
    bought: SavedBoughtCosmetics,
    rankNumber: number,
  ): (kind: CosmeticKind) => GearTap
  (
    kind: CosmeticKind,
    name: string,
    worn: string,
    bought: SavedBoughtCosmetics,
    rankNumber: number,
  ): GearTap
} = Function.dual(
  5,
  (
    kind: CosmeticKind,
    name: string,
    worn: string,
    bought: SavedBoughtCosmetics,
    rankNumber: number,
  ): GearTap => {
    const standing = standingOf(kind, name, worn, bought, rankNumber)
    return standing === 'Worn'
      ? 'Stay'
      : standing === 'Owned'
        ? 'Wear'
        : standing === 'Locked'
          ? 'Locked'
          : 'Preview'
  },
)

export const priceOf: {
  (name: string): (kind: CosmeticKind) => Option.Option<number>
  (kind: CosmeticKind, name: string): Option.Option<number>
} = Function.dual(
  2,
  (kind: CosmeticKind, name: string): Option.Option<number> => {
    const source = sourceOf(kind, name)
    return source.kind === 'Sold' ? Option.some(source.price) : Option.none()
  },
)
