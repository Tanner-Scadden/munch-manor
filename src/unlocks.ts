import { Array } from 'effect'

import { CALLINGS, UNLOCK_RANKS } from './calling'
import { GIFTS, type Gift } from './closet'
import type { SavedSeenUnlocks } from './playerData'

// NEW badges (GAME_DESIGN.md, "Rank and Bones"): an unlock the player has
// reached and not seen yet wears a NEW badge until the Look tab or the
// character picker opens. An unlock is a gift look or a calling, named by an
// id such as `hat:Fez`, `shirt:Gold`, `skin:Slime`, or `calling:Handyman`.
// What was seen is saved and synced as a set (SavedSeenUnlocks). A look the
// player bought is never an unlock: they just picked it. Nothing here reads
// the Model.

const giftUnlockId = ({ kind, name }: Gift): string =>
  `${kind.toLowerCase()}:${name}`

export const lookUnlockId = (kind: Gift['kind'], name: string): string =>
  giftUnlockId({ kind, name, rank: 0 })

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

export const unseenOf = (
  reached: ReadonlyArray<string>,
  seen: SavedSeenUnlocks,
): ReadonlyArray<string> =>
  Array.filter(reached, id => !Array.contains(seen, id))

const isCallingId = (id: string): boolean => id.startsWith('calling:')

export const isLookId = (id: string): boolean => !isCallingId(id)

// NOTE: whether the Profile's Look tab, or the character picker, has an
// unlock to show as new. The pips on the home menu's Profile and the Look
// tab read the first, the picker's the second.
export const hasUnseenLook = (rank: number, seen: SavedSeenUnlocks): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenOf(lookUnlocksAt(rank), seen))

export const hasUnseenCalling = (
  rank: number,
  seen: SavedSeenUnlocks,
): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenOf(callingUnlocksAt(rank), seen))
