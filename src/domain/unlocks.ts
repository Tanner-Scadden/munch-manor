import { Array, Function, Option, String } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import type { Calling, SavedSeenUnlocks } from '../shared/playerData'
import { purseBonesAt } from '../shared/rankCurve'
import { CALLINGS, UNLOCK_RANKS } from '../world/heroes/calling'
import { rankOf, totalPointsOf } from '../world/heroes/rank'
import { GIFTS, type Gift } from './closet'

// NEW badges (GAME_DESIGN.md, "Rank and Bones"): an unlock the player has
// reached and not seen yet wears a NEW badge until the Look tab or the
// character picker opens. An unlock is a gift look or a calling, named by an
// id such as `hat:Fez`, `shirt:Gold`, `skin:Slime`, or `calling:Handyman`.
// What was seen is saved and synced as a set (SavedSeenUnlocks). A look the
// player bought is never an unlock: they just picked it. Nothing here reads
// the Model.

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

// NOTE: YOU is open from the start, so it is never new.
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

// NOTE: the gift looks a player of this rank has reached, and the callings.
export const lookUnlocksAt = (rank: number): ReadonlyArray<string> =>
  reachedAt(LOOK_UNLOCKS, rank)

export const callingUnlocksAt = (rank: number): ReadonlyArray<string> =>
  reachedAt(CALLING_UNLOCKS, rank)

// NOTE: every unlock reached at a rank, for a save that has no record of
// what was seen: all of them count as seen.
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

// NOTE: whether the Profile's Look tab, or the character picker, has an
// unlock to show as new. The pips on the home menu's Profile and the Look
// tab read the first, the picker's the second.
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

// WHAT A RANK GIVES

// NOTE: every rank from 2 on gives one thing (docs/PROGRESSION_PLAN.md,
// pillar B): a hero for sale, a gift look, or a Bones purse
// (src/shared/rankCurve.ts). The home menu and the Profile show the next
// rank's by the rank (src/ui/rankBadgeView.ts). `Nothing` is rank 1.
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

// MARKING SEEN

// NOTE: NEW badges: opening a surface marks every unlock on it
// seen, with no click on the item. The ones that were unseen keep their
// badge while it stays open, in `freshUnlocks`, and are gone the next time.

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
    return modifyFields(model, {
      freshUnlocks: fresh => [
        ...Array.filter(fresh, id => !isOnSurface(id)),
        ...unseen,
      ],
      seenUnlocks: seen => Array.union(seen, unseen),
    })
  }

// NOTE: the Look tab opened: its gift looks.
export const markLooksSeen = markSeen(lookUnlocksAt, isLookId)

// NOTE: the hero picker opened: its callings.
export const markCallingsSeen = markSeen(callingUnlocksAt, id => !isLookId(id))

// NOTE: an unlock the player picked: its NEW badge goes at once, whatever is
// still open. It was marked seen when its surface opened.
export const withoutFresh: {
  (id: string): (model: Model) => Model
  (model: Model, id: string): Model
} = Function.dual(2, (model: Model, id: string): Model =>
  Array.contains(model.freshUnlocks, id)
    ? modifyFields(model, {
        freshUnlocks: fresh => Array.filter(fresh, other => other !== id),
      })
    : model,
)
