import { Array, Function, Result, String } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { addToJournal } from '#shared/journalData.ts'
import { dareItemsFoundOf } from '#world/dare/dare.ts'
import {
  THING_ROOMS,
  newMilestonesOf,
  thingsOpenedBy,
} from '#world/dare/milestones.ts'
import { levelOf, roomAt } from '#world/level/arena.ts'
import { focusOf } from '#world/party/party.ts'
import { GameEvent } from '#world/schema/worldSchema.ts'

import { isEndScreen, isInRun } from './run.ts'

const isThingRoom = (id: string): boolean => Array.contains(THING_ROOMS, id)

const foundRoomsOf = (model: Model): ReadonlyArray<string> =>
  Array.filterMap(model.frameEvents, event => {
    if (!GameEvent.isAnyOf(['DareFound'])(event)) {
      return Result.failVoid
    }
    const { id } = roomAt(levelOf(model), event)
    return isThingRoom(id) ? Result.succeed(id) : Result.failVoid
  })

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
    id => !Array.contains(after.runGains.journalRun.foundIn, id),
  )
  return Array.isReadonlyArrayNonEmpty(rooms)
    ? UiStruct.evolve(after, {
        runGains: UiStruct.evolve({
          journalRun: run =>
            UiStruct.evolve(run, {
              foundIn: found => Array.union(found, rooms),
            }),
        }),
      })
    : after
})

const openedRoomsOf = (run: Model): ReadonlyArray<string> =>
  Array.filterMap(levelOf(run).rooms, ({ id, isOpen }) =>
    isOpen && isThingRoom(id) ? Result.succeed(id) : Result.failVoid,
  )

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
    roomsFoundIn: after.runGains.journalRun.foundIn,
    heroesPlayed: [focusOf(after).player.calling],
    thingsFound: dareItemsFoundOf(after),
  })
  const reached = newMilestonesOf({
    journal,
    proof: after.proof,
    bonuses: after.bonuses,
  })
  return UiStruct.evolve(after, {
    journal: () =>
      addToJournal(journal, {
        milestones: reached,
        roomsOpened: [],
        roomsFoundIn: [],
        heroesPlayed: [],
        thingsFound: 0,
      }),
    runGains: UiStruct.evolve({
      journalRun: run => UiStruct.evolve(run, { reached: () => reached }),
    }),
  })
})

export const openedThingsOf = (model: Model) =>
  thingsOpenedBy(model.journal.milestones)

export const milestoneUnlockId = (id: string): string => `journal:${id}`

const isJournalId = (id: string): boolean => String.startsWith('journal:')(id)

const unseenJournalOf = (model: Model): ReadonlyArray<string> =>
  Array.filter(
    Array.map(model.journal.milestones, milestoneUnlockId),
    id => !Array.contains(model.seenUnlocks, id),
  )

export const hasNewJournalPage = (model: Model): boolean =>
  Array.isReadonlyArrayNonEmpty(unseenJournalOf(model))

export const markJournalSeen = (model: Model): Model => {
  const unseen = unseenJournalOf(model)
  return UiStruct.evolve(model, {
    freshUnlocks: fresh => [
      ...Array.filter(fresh, id => !isJournalId(id)),
      ...unseen,
    ],
    seenUnlocks: seen => Array.union(seen, unseen),
  })
}
