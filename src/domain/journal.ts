import { Array, Function, Result, String } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import { addToJournal } from '../shared/journalData'
import { dareItemsFoundOf } from '../world/dare/dare'
import {
  THING_ROOMS,
  newMilestonesOf,
  thingsOpenedBy,
} from '../world/dare/milestones'
import { levelOf, roomAt } from '../world/level/arena'
import { focusOf } from '../world/party/party'
import { GameEvent } from '../world/schema/worldSchema'
import { isEndScreen, isInRun } from './run'

// The Dare Journal's client rules (docs/PROGRESSION_PLAN.md, pillar B):
// what a run adds to the saved journal (src/shared/journalData.ts), the
// milestones that reaches (src/world/dare/milestones.ts), and the NEW
// pips they raise. Read by the journal's pages
// (src/features/munchopedia/), the end card's unlock cards
// (src/features/end/), and the shelf (src/features/proof/).

// A RUN'S FINDS

const isThingRoom = (id: string): boolean => Array.contains(THING_ROOMS, id)

// NOTE: the rooms the frame's finds were in, from each DareFound's spot.
const foundRoomsOf = (model: Model): ReadonlyArray<string> =>
  Array.filterMap(model.frameEvents, event => {
    if (!GameEvent.isAnyOf(['DareFound'])(event)) {
      return Result.failVoid
    }
    const { id } = roomAt(levelOf(model), event)
    return isThingRoom(id) ? Result.succeed(id) : Result.failVoid
  })

// NOTE: the frame's finds tallied into the run's rooms found in, only when
// a frame brought new events, so a quiet frame costs one comparison.
export const tallyJournalFrom: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (
    after.frameEvents === before.frameEvents ||
    !Array.isReadonlyArrayNonEmpty(after.frameEvents) ||
    !isInRun(after.phase)
  ) {
    return after
  }
  const rooms = Array.filter(
    foundRoomsOf(after),
    id => !Array.contains(after.journalRun.foundIn, id),
  )
  return Array.isReadonlyArrayNonEmpty(rooms)
    ? modifyFields(after, {
        journalRun: run =>
          modifyFields(run, {
            foundIn: found => Array.union(found, rooms),
          }),
      })
    : after
})

// THE PAYOUT

const openedRoomsOf = (run: Model): ReadonlyArray<string> =>
  Array.filterMap(levelOf(run).rooms, ({ id, isOpen }) =>
    isOpen && isThingRoom(id) ? Result.succeed(id) : Result.failVoid,
  )

// NOTE: on the frame a run reaches its end screen (munched, escaped, or
// out the back door), what it did goes in the journal: its rooms opened and
// found in, its hero, and its things found. Then every milestone the
// player now meets is reached, kept in the journal and in the run's record
// for the end card's unlock cards. A run left from the pause MENU adds
// nothing, as on the shelf.
export const keepJournal: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (isEndScreen(before.phase) || !isEndScreen(after.phase)) {
    return after
  }
  const journal = addToJournal(after.journal, {
    milestones: [],
    roomsOpened: openedRoomsOf(after),
    roomsFoundIn: after.journalRun.foundIn,
    heroesPlayed: [focusOf(after).player.calling],
    thingsFound: dareItemsFoundOf(after),
  })
  const reached = newMilestonesOf({
    journal,
    proof: after.proof,
    bonuses: after.bonuses,
  })
  return modifyFields(after, {
    journal: () =>
      addToJournal(journal, {
        milestones: reached,
        roomsOpened: [],
        roomsFoundIn: [],
        heroesPlayed: [],
        thingsFound: 0,
      }),
    journalRun: run => modifyFields(run, { reached: () => reached }),
  })
})

// NOTE: the dare things this player's milestones open, for the next run
// they start (and, as host, their room's).
export const openedThingsOf = (model: Model) =>
  thingsOpenedBy(model.journal.milestones)

// NEW PIPS

// NOTE: each milestone reached is an unlock id in the synced set of what
// was seen (src/domain/unlocks.ts), so the journal's NEW pip clears on
// every device once the journal has been opened.
export const milestoneUnlockId = (id: string): string => `journal:${id}`

const isJournalId = (id: string): boolean => String.startsWith('journal:')(id)

const unseenJournalOf = (model: Model): ReadonlyArray<string> =>
  Array.filter(
    Array.map(model.journal.milestones, milestoneUnlockId),
    id => !Array.contains(model.seenUnlocks, id),
  )

export const hasNewJournalPage = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenJournalOf(model))

// NOTE: the journal opened: every milestone is seen, and what was not
// wears NEW while it stays open.
export const markJournalSeen = (model: Model): Model => {
  const unseen = unseenJournalOf(model)
  return modifyFields(model, {
    freshUnlocks: fresh => [
      ...Array.filter(fresh, id => !isJournalId(id)),
      ...unseen,
    ],
    seenUnlocks: seen => Array.union(seen, unseen),
  })
}
