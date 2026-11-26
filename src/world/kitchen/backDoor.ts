import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

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

type BackDoorRules = Readonly<{
  holdMs: number
  reachPx: number
  tagInsetPx: number
  standInsetPx: number
}>

export const BACK_DOOR_RULES: BackDoorRules = {
  holdMs: 2000,
  reachPx: 14,
  tagInsetPx: 26,
  standInsetPx: 6,
}

const BACK_DOOR_TILE = { column: 19, row: KITCHEN_TOP_ROW + 13 }
const BACK_DOOR_ROWS = 2

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

export const backDoorStandOf = (level: Level): Option.Option<Vector> =>
  Option.map(backDoorBoxOf(level), box => ({
    x: box.left - BACK_DOOR_RULES.standInsetPx,
    y: (box.top + box.bottom) / 2,
  }))

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

export const isBackDoorOpen = (world: World): boolean =>
  isBackDoorUp(world) && dareItemsFoundOf(world) > 0

const isInReach = (box: Box, point: Vector): boolean =>
  distanceToBox(point, box) <= BACK_DOOR_RULES.reachPx

const waitedFor = (world: World): ReadonlyArray<Vector> =>
  Array.map(
    Array.filter(
      playersOf(world),
      ({ seat }) => isStanding(seat) && isHere(seat),
    ),
    ({ player }) => player,
  )

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

export const isCrewAtBackDoor = (world: World): boolean => {
  const { at, of } = crewAtBackDoorOf(world)
  return of > 0 && at === of
}

const tagSpotOf = (box: Box): Vector => ({
  x: box.left - BACK_DOOR_RULES.tagInsetPx,
  y: box.top + 2,
})

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

export const leaveEarly = (world: World): Option.Option<World> =>
  isBackDoorOpen(world) && isCrewAtBackDoor(world)
    ? Option.some(
        UiStruct.evolve(world, {
          phase: () => Phase.LeftEarly({ wave: roundWaveOf(world.phase) }),
        }),
      )
    : Option.none()

export const isBackDoorHoldPaused: {
  (target: Purchasable): (world: World) => boolean
  (world: World, target: Purchasable): boolean
} = Function.dual(
  2,
  (world: World, target: Purchasable): boolean =>
    Purchasable.isAnyOf(['BackDoor'])(target) && !isCrewAtBackDoor(world),
)
