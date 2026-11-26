import { Array, Function, Option, String } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../app/model'
import type { Calling, SavedSeenUnlocks } from '../shared/playerData'
import { purseBonesAt } from '../shared/rankCurve'
import { CALLINGS, UNLOCK_RANKS } from '../world/heroes/calling'
import { rankOf, totalPointsOf } from '../world/heroes/rank'
import { GIFTS, type Gift } from './closet'

const giftUnlockId = ({ kind, name }: Gift): string =>
  `${String.toLowerCase(kind)}:${name}`

export const lookUnlockId: {
  (name: string): (kind: Gift['kind']) => string
  (kind: Gift['kind'], name: string): string
} = Function.dual(2, (kind: Gift['kind'], name: string): string =>
  giftUnlockId({ kind, name, rank: 0 }),
)

export const callingUnlockId = (calling: string): string => `calling:${calling}`

type Unlock = Readonly<{ id: string; rank: number }>

const LOOK_UNLOCKS: ReadonlyArray<Unlock> = Array.map(GIFTS, gift => ({
  id: giftUnlockId(gift),
  rank: gift.rank,
}))

const CALLING_UNLOCKS: ReadonlyArray<Unlock> = Array.flatMap(
  CALLINGS,
  calling =>
    calling === 'You'
      ? []
      : [{ id: callingUnlockId(calling), rank: UNLOCK_RANKS[calling] }],
)

const reachedAt = (
  unlocks: ReadonlyArray<Unlock>,
  rank: number,
): ReadonlyArray<string> =>
  Array.flatMap(unlocks, unlock => (unlock.rank <= rank ? [unlock.id] : []))

export const lookUnlocksAt = (rank: number): ReadonlyArray<string> =>
  reachedAt(LOOK_UNLOCKS, rank)

export const callingUnlocksAt = (rank: number): ReadonlyArray<string> =>
  reachedAt(CALLING_UNLOCKS, rank)

export const unlocksAt = (rank: number): ReadonlyArray<string> => [
  ...lookUnlocksAt(rank),
  ...callingUnlocksAt(rank),
]

const unseenOf: {
  (
    seen: SavedSeenUnlocks,
  ): (reached: ReadonlyArray<string>) => ReadonlyArray<string>
  (
    reached: ReadonlyArray<string>,
    seen: SavedSeenUnlocks,
  ): ReadonlyArray<string>
} = Function.dual(
  2,
  (
    reached: ReadonlyArray<string>,
    seen: SavedSeenUnlocks,
  ): ReadonlyArray<string> =>
    Array.filter(reached, id => !Array.contains(seen, id)),
)

const isCallingId = (id: string): boolean => String.startsWith('calling:')(id)

const isLookId = (id: string): boolean => !isCallingId(id)

export const hasUnseenLook: {
  (seen: SavedSeenUnlocks): (rank: number) => boolean
  (rank: number, seen: SavedSeenUnlocks): boolean
} = Function.dual(2, (rank: number, seen: SavedSeenUnlocks): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenOf(lookUnlocksAt(rank), seen)),
)

export const hasUnseenCalling: {
  (seen: SavedSeenUnlocks): (rank: number) => boolean
  (rank: number, seen: SavedSeenUnlocks): boolean
} = Function.dual(2, (rank: number, seen: SavedSeenUnlocks): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenOf(callingUnlocksAt(rank), seen)),
)

export type RankGift =
  | Readonly<{ kind: 'Hero'; calling: Calling }>
  | Readonly<{ kind: 'Look'; gift: Gift }>
  | Readonly<{ kind: 'Purse'; bones: number }>
  | Readonly<{ kind: 'Nothing' }>

export const giftAtRank = (rank: number): RankGift =>
  Option.match(
    Array.findFirst(CALLINGS, calling => UNLOCK_RANKS[calling] === rank),
    {
      onSome: (calling): RankGift =>
        calling === 'You' ? { kind: 'Nothing' } : { kind: 'Hero', calling },
      onNone: () =>
        Option.match(
          Array.findFirst(GIFTS, gift => gift.rank === rank),
          {
            onSome: (gift): RankGift => ({ kind: 'Look', gift }),
            onNone: () =>
              Option.match(purseBonesAt(rank), {
                onSome: (bones): RankGift => ({ kind: 'Purse', bones }),
                onNone: (): RankGift => ({ kind: 'Nothing' }),
              }),
          },
        ),
    },
  )

const markSeen =
  (
    surfaceUnlocksAt: (rank: number) => ReadonlyArray<string>,
    isOnSurface: (id: string) => boolean,
  ) =>
  (model: Model): Model => {
    const unseen = unseenOf(
      surfaceUnlocksAt(rankOf(totalPointsOf(model.rank))),
      model.seenUnlocks,
    )
    return UiStruct.evolve(model, {
      freshUnlocks: fresh => [
        ...Array.filter(fresh, id => !isOnSurface(id)),
        ...unseen,
      ],
      seenUnlocks: seen => Array.union(seen, unseen),
    })
  }

export const markLooksSeen = markSeen(lookUnlocksAt, isLookId)

export const markCallingsSeen = markSeen(callingUnlocksAt, id => !isLookId(id))

export const withoutFresh: {
  (id: string): (model: Model) => Model
  (model: Model, id: string): Model
} = Function.dual(2, (model: Model, id: string): Model =>
  Array.contains(model.freshUnlocks, id)
    ? UiStruct.evolve(model, {
        freshUnlocks: fresh => Array.filter(fresh, other => other !== id),
      })
    : model,
)
