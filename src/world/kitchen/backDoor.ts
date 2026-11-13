import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { dareItemsFoundOf } from '../dare/dare'
import { Finale } from '../dare/dareSchema'
import { hasChunkInHouse } from '../dare/finale'
import { type Level, levelOf } from '../level/arena'
import { KITCHEN_TOP_ROW } from '../level/plan'
import { type Box, distanceToBox, tileBox } from '../level/tileGrid'
import { isHere, isStanding, playersOf } from '../party/party'
import type { World } from '../schema/world'
import {
  Phase,
  Purchasable,
  RunMode,
  type Vector,
  roundWaveOf,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { isKitchenOpen } from './kitchen'

// Leaving early (docs/PROGRESSION_PLAN.md, pillar A; LORE.md, "Leaving
// early"): the kitchen's back door to the garden, in the east wall's south
// corner. In a break, once the crew has found at least one thing on the
// list, a player holds it open the way the boards are bought (the stand or
// hold of src/world/shop/purchase.ts, no keys), and the run ends LeftEarly:
// the points for the waves and the things found, no Uncle Chunk and no
// escape's 100 (src/world/heroes/rank.ts). With nothing found it would only
// be quitting, so its tag is there but a press shakes it. Endless has no
// list, so no back door; and once Uncle Chunk is in the house, or his key
// has opened the front door, the only way out is the front.
//
// In a crew everyone leaves together: the hold fills only while every
// player standing in the house (and here) is at the door, as READY waits
// for everyone, so nobody is pulled out of a run they want. The downed go
// with the crew, as at the front door.

type BackDoorRules = Readonly<{
  holdMs: number
  reachPx: number
  tagInsetPx: number
  standInsetPx: number
}>

// NOTE: two seconds of the key (four standing), as long as the stove's
// cook: leaving is a choice for the whole run, never a stroll past.
export const BACK_DOOR_RULES: BackDoorRules = {
  holdMs: 2000,
  reachPx: 14,
  tagInsetPx: 26,
  standInsetPx: 6,
}

// NOTE: the door's two wall tiles, the east wall's last two rows, out to
// the garden; the yard beyond is outside the house.
const BACK_DOOR_TILE = { column: 19, row: KITCHEN_TOP_ROW + 13 }
const BACK_DOOR_ROWS = 2

// READING

export const backDoorBoxOf = (level: Level): Option.Option<Box> => {
  if (!isKitchenOpen(level)) {
    return Option.none()
  }
  const top = tileBox(BACK_DOOR_TILE)
  return Option.some({
    ...top,
    bottom: top.top + (top.bottom - top.top) * BACK_DOOR_ROWS,
  })
}

// NOTE: where a player stands to hold the door: just inside it, in reach,
// for the teammate bots walking over to leave with the crew.
export const backDoorStandOf = (level: Level): Option.Option<Vector> =>
  Option.map(backDoorBoxOf(level), box => ({
    x: box.left - BACK_DOOR_RULES.standInsetPx,
    y: (box.top + box.bottom) / 2,
  }))

// NOTE: whether the run has a back door at all right now: a campaign run's
// break, before the front door's finale has begun.
const isBackDoorUp = (world: World): boolean =>
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  RunMode.isAnyOf(['Campaign'])(world.mode) &&
  Array.isReadonlyArrayNonEmpty(world.dare.list) &&
  Finale.match(world.dare.finale, {
    Hunting: () => true,
    Summoned: () => !hasChunkInHouse(world),
    KeyFlying: () => false,
    Open: () => false,
  })

// NOTE: open to leave by: up, and a thing on the list found.
export const isBackDoorOpen = (world: World): boolean =>
  isBackDoorUp(world) && dareItemsFoundOf(world) > 0

const isInReach = (box: Box, point: Vector): boolean =>
  distanceToBox(point, box) <= BACK_DOOR_RULES.reachPx

// NOTE: the players the door waits for: everyone standing in the house and
// here. A downed or bled-out player goes with the crew; one away cannot
// walk over, so they are carried out too.
const waitedFor = (world: World): ReadonlyArray<Vector> =>
  Array.map(
    Array.filter(
      playersOf(world),
      ({ seat }) => isStanding(seat) && isHere(seat),
    ),
    ({ player }) => player,
  )

// NOTE: how many of the players the door waits for stand at it, of how many.
export const crewAtBackDoorOf = (
  world: World,
): Readonly<{ at: number; of: number }> =>
  Option.match(backDoorBoxOf(levelOf(world)), {
    onNone: () => ({ at: 0, of: waitedFor(world).length }),
    onSome: box => {
      const crew = waitedFor(world)
      return {
        at: Array.filter(crew, player => isInReach(box, player)).length,
        of: crew.length,
      }
    },
  })

// NOTE: the whole crew at the door: a hold there fills only then.
export const isCrewAtBackDoor = (world: World): boolean => {
  const { at, of } = crewAtBackDoorOf(world)
  return of > 0 && at === of
}

// THE OFFER

// NOTE: the tag hangs in the kitchen just west of the door, clear of the
// door's art and its key prompt, so the door itself stays in view.
const tagSpotOf = (box: Box): Vector => ({
  x: box.left - BACK_DOOR_RULES.tagInsetPx,
  y: box.top + 2,
})

// NOTE: the door for sale at no price while it is up: full (a press shakes
// it, standing does nothing) until a thing is found.
export const backDoorOffers = (world: World): ReadonlyArray<Offer> =>
  isBackDoorUp(world)
    ? Option.match(backDoorBoxOf(levelOf(world)), {
        onNone: () => [],
        onSome: box => [
          {
            target: Purchasable.BackDoor(),
            price: 0,
            box,
            reachPx: BACK_DOOR_RULES.reachPx,
            isFull: dareItemsFoundOf(world) === 0,
            spot: tagSpotOf(box),
          },
        ],
      })
    : []

// THE WAY OUT

// NOTE: the hold done: the crew walks out the back and the run ends.
export const leaveEarly = (world: World): Option.Option<World> =>
  isBackDoorOpen(world) && isCrewAtBackDoor(world)
    ? Option.some(
        modifyFields(world, {
          phase: () => Phase.LeftEarly({ wave: roundWaveOf(world.phase) }),
        }),
      )
    : Option.none()

// NOTE: a hold at the back door counts only while the whole crew is there.
export const isBackDoorHoldPaused: {
  (target: Purchasable): (world: World) => boolean
  (world: World, target: Purchasable): boolean
} = Function.dual(
  2,
  (world: World, target: Purchasable): boolean =>
    Purchasable.isAnyOf(['BackDoor'])(target) && !isCrewAtBackDoor(world),
)
