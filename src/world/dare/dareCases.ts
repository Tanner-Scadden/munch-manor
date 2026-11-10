import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { caseFootOf, isCaseShown } from '../feats/caseSpots'
import { openCaseFor } from '../feats/cases'
import { hasStoveFeat, maybeStovePerk, stoveBoxOf } from '../kitchen/stove'
import { levelOf } from '../level/arena'
import {
  forEachSeat,
  isStanding,
  modifySeat,
  playersOf,
  seatStateAt,
} from '../party/party'
import type { World } from '../schema/world'
import {
  CaseState,
  type DisplayCase,
  type PlayerSlot,
  type Vector,
} from '../schema/worldSchema'
import { distanceBetween } from '../step/geometry'
import { DELIVER_REACH_PX, deliverHeld, dropAt, heldBy } from './dare'
import { DareThingState } from './dareSchema'

// The dare's things that come out of the house's fixtures (docs/ESCAPE_PLAN.md,
// layer 12): the guest book's page locked in a display case, Grandma's recipe
// in the kitchen's stove, and a thing off the list brought to a case. Apart
// from src/world/dare/dare.ts so the dare's rules and the cases'
// (src/world/feats/cases.ts) never import each other.

// NOTE: how far in front of a case's foot or the stove's front a thing falls,
// so it lies on the floor a player walks.
const DROP_IN_FRONT_PX = 6

// DELIVERING

const isLocked = (displayCase: DisplayCase): boolean =>
  CaseState.isAnyOf(['Locked'])(displayCase.state)

// NOTE: a standing player with a thing off the list in hand, at a locked
// case in an open room, delivers it there (the Delivered feat's tally), and
// the case springs open for them, whatever its own feat.
const deliverFor = (world: World, slot: PlayerSlot): World => {
  const { seat, player } = seatStateAt(world, slot)
  if (!isStanding(seat) || Array.isReadonlyArrayEmpty(heldBy(world, slot))) {
    return world
  }
  const level = levelOf(world)
  return Option.match(
    Array.findFirst(
      world.cases,
      displayCase =>
        isLocked(displayCase) &&
        isCaseShown(level, displayCase) &&
        distanceBetween(player, caseFootOf(level, displayCase)) <=
          DELIVER_REACH_PX,
    ),
    {
      onNone: () => world,
      onSome: displayCase =>
        openCaseFor(
          modifySeat(
            deliverHeld(world, slot, caseFootOf(level, displayCase)),
            slot,
            {
              feats: feats =>
                modifyFields(feats, { delivered: count => count + 1 }),
            },
          ),
          displayCase,
          slot,
        ),
    },
  )
}

// THE CASE'S PAGE

const inFrontOf = (point: Vector): Vector => ({
  x: point.x,
  y: point.y + DROP_IN_FRONT_PX,
})

// NOTE: once the case holding a thing has opened, the thing falls out in
// front of it.
const dropFromOpenedCases = (world: World): World => {
  const level = levelOf(world)
  return Array.reduce(world.dareThings, world, (current, thing) =>
    DareThingState.isAnyOf(['InCase'])(thing.state)
      ? Option.match(
          Array.findFirst(
            current.cases,
            ({ id, state }) =>
              DareThingState.isAnyOf(['InCase'])(thing.state) &&
              id === thing.state.caseId &&
              !CaseState.isAnyOf(['Locked'])(state),
          ),
          {
            onNone: () => current,
            onSome: displayCase =>
              dropAt(current, thing, inFrontOf(caseFootOf(level, displayCase))),
          },
        )
      : current,
  )
}

// THE STOVE'S RECIPE

const hasAnyStoveFeat = (world: World): boolean =>
  Array.some(
    playersOf(world),
    ({ seat }) => isStanding(seat) && hasStoveFeat(world, seat.slot),
  )

// NOTE: Grandma's recipe cooks out of the stove once, the first break a
// player has earned the stove's feat with the kitchen open.
const cookRecipe = (world: World): World =>
  Array.some(world.dareThings, ({ state }) =>
    DareThingState.isAnyOf(['InStove'])(state),
  ) &&
  Option.isSome(maybeStovePerk(world)) &&
  hasAnyStoveFeat(world)
    ? Option.match(stoveBoxOf(world), {
        onNone: () => world,
        onSome: box =>
          Array.reduce(world.dareThings, world, (current, thing) =>
            DareThingState.isAnyOf(['InStove'])(thing.state)
              ? dropAt(
                  current,
                  thing,
                  inFrontOf({ x: (box.left + box.right) / 2, y: box.bottom }),
                )
              : current,
          ),
      })
    : world

// NOTE: one tick of the dare's fixtures, after the cases have opened for
// their feats: deliveries, then what an opened case or the stove lets go.
export const advanceDareCases = (world: World): World =>
  Array.isReadonlyArrayEmpty(world.dareThings)
    ? world
    : cookRecipe(dropFromOpenedCases(forEachSeat(world, deliverFor)))
