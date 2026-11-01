import { Array } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../model'
import { rankOf, totalPointsOf } from '../rank'
import { callingUnlocksAt, isLookId, lookUnlocksAt, unseenOf } from '../unlocks'

// NEW badges (src/unlocks.ts): opening a surface marks every unlock on it
// seen, with no click on the item. The ones that were unseen keep their
// badge while it stays open, in `freshUnlocks`, and are gone the next time.

const markSeen =
  (
    reachedAt: (rank: number) => ReadonlyArray<string>,
    isOnSurface: (id: string) => boolean,
  ) =>
  (model: Model): Model => {
    const unseen = unseenOf(
      reachedAt(rankOf(totalPointsOf(model.rank))),
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
