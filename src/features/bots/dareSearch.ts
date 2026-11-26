import { Array, Function, Option, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { isHiddenInDark } from '../../world/cellar/bulb'
import {
  findStyleOf,
  maybeLyingAt,
  maybeThingRoom,
} from '../../world/dare/dare'
import { isFrontDoorOpen } from '../../world/dare/finale'
import { FIND_RULES } from '../../world/dare/finds'
import {
  chandelierHitBox,
  gapBoxOf,
  isChandelierDown,
} from '../../world/dining/chandelier'
import { heldKeys } from '../../world/keys/keys'
import { maybeStash, pantrySpotOf } from '../../world/kitchen/pantry'
import {
  type Level,
  TILE_PLAYER_SOLID,
  hasTileFlag,
  levelOf,
} from '../../world/level/arena'
import { exitPriceFor } from '../../world/level/exits'
import {
  type Box,
  circleTouchesBox,
  distanceToBox,
  isInsideRoom,
  tileIndex,
  tileOfIndex,
} from '../../world/level/tileGrid'
import { hasLineOfSight, tileIndexAt } from '../../world/level/tileQueries'
import type { World } from '../../world/schema/world'
import { ExitId, Phase, type Vector } from '../../world/schema/worldSchema'
import { stationBoxOf } from '../../world/stations/stationSpots'
import { isInWave } from '../../world/stations/stations'
import { TOOL_RULES } from '../../world/stations/toolRules'
import { distanceBetween } from '../../world/step/geometry'
import { bodyRadiusOf, isGrounded } from '../../world/zombies/zombies'

const SAFE_PX = 45

const REACH_SLACK_PX = 2

const BESIDE_PX = 5

export const isStandableTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    !hasTileFlag(level, tileIndex(level, column, row), TILE_PLAYER_SOLID),
)

const isStandableAt = (level: Level, point: Vector): boolean => {
  const { column, row } = tileOfIndex(level, tileIndexAt(level, point))
  return isStandableTile(level, column, row)
}

export const besideBox: {
  (box: Box): (level: Level) => Vector
  (level: Level, box: Box): Vector
} = Function.dual(2, (level: Level, box: Box): Vector => {
  const middle = {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  }
  const candidates: ReadonlyArray<Vector> = [
    { x: middle.x, y: box.bottom + BESIDE_PX },
    { x: box.right + BESIDE_PX, y: middle.y },
    { x: box.left - BESIDE_PX, y: middle.y },
    { x: middle.x, y: box.top - BESIDE_PX },
  ]
  return Option.getOrElse(
    Array.findFirst(candidates, point => isStandableAt(level, point)),
    () => middle,
  )
})

type Lying = Readonly<{
  spot: Vector
  reachPx: number
  isWorked: boolean
  isDark: boolean
}>

const lyingThings = (world: World): ReadonlyArray<Lying> => {
  const level = levelOf(world)
  return Array.flatMap(world.dareThings, thing =>
    Option.toArray(
      Option.map(maybeLyingAt(thing, level), (spot): Lying => {
        const { reachPx, workMs } = FIND_RULES[findStyleOf(thing, level)]
        return {
          spot,
          reachPx,
          isWorked: workMs > 0,
          isDark: isHiddenInDark(world, spot),
        }
      }),
    ),
  )
}

const nearestLit = (
  from: Vector,
  things: ReadonlyArray<Lying>,
): Lying | undefined =>
  Array.reduce(things, undefined, (nearest: Lying | undefined, thing) =>
    !thing.isDark &&
    (nearest === undefined ||
      distanceBetween(from, thing.spot) < distanceBetween(from, nearest.spot))
      ? thing
      : nearest,
  )

const maybeBulbBox = (world: World): Option.Option<Box> =>
  world.stations.Bulb.cooldownMs > 0
    ? Option.none()
    : stationBoxOf(levelOf(world), 'Bulb')

const isDarkThingLeft = (things: ReadonlyArray<Lying>): boolean =>
  Array.some(things, ({ isDark }) => isDark)

export const searchSpot: {
  (from: Vector): (world: World) => Vector | undefined
  (world: World, from: Vector): Vector | undefined
} = Function.dual(2, (world: World, from: Vector): Vector | undefined => {
  if (isFrontDoorOpen(world)) {
    return undefined
  }
  const things = lyingThings(world)
  const lit = nearestLit(from, things)
  if (lit !== undefined) {
    return lit.spot
  }
  return isInWave(world) && isDarkThingLeft(things)
    ? Option.getOrUndefined(
        Option.map(maybeBulbBox(world), box => besideBox(levelOf(world), box)),
      )
    : undefined
})

export const isSafeToSearch: {
  (at: Vector): (world: World) => boolean
  (world: World, at: Vector): boolean
} = Function.dual(
  2,
  (world: World, at: Vector): boolean =>
    !Array.some(
      world.zombies,
      zombie => zombie.hp > 0 && distanceBetween(at, zombie) < SAFE_PX,
    ),
)

export const isWorkingSearch: {
  (at: Vector): (world: World) => boolean
  (world: World, at: Vector): boolean
} = Function.dual(2, (world: World, at: Vector): boolean => {
  if (isFrontDoorOpen(world)) {
    return false
  }
  const things = lyingThings(world)
  const atFind = Array.some(
    things,
    ({ spot, reachPx, isWorked, isDark }) =>
      isWorked &&
      !isDark &&
      distanceBetween(at, spot) <= reachPx - REACH_SLACK_PX,
  )
  return (
    atFind ||
    (isInWave(world) &&
      isDarkThingLeft(things) &&
      Option.exists(
        maybeBulbBox(world),
        box =>
          distanceToBox(at, box) <= TOOL_RULES.Bulb.reachPx - REACH_SLACK_PX,
      ))
  )
})

export const pantryErrand = (world: World): Vector | undefined =>
  Option.getOrUndefined(
    Option.flatMap(maybeStash(world), () => pantrySpotOf(levelOf(world))),
  )

export const CHANDELIER_CROWD = 3

export const chandelierShot: {
  (at: Vector): (world: World) => Option.Option<Vector>
  (world: World, at: Vector): Option.Option<Vector>
} = Function.dual(2, (world: World, at: Vector): Option.Option<Vector> => {
  if (!Phase.isAnyOf(['Wave'])(world.phase) || isChandelierDown(world)) {
    return Option.none()
  }
  const level = levelOf(world)
  return Option.flatMap(gapBoxOf(level), gap => {
    const under = Array.filter(
      world.zombies,
      zombie =>
        zombie.state._tag === 'Walking' &&
        isGrounded(zombie) &&
        circleTouchesBox(zombie, bodyRadiusOf(zombie), gap),
    ).length
    const hit = chandelierHitBox(gap)
    const aim = {
      x: (hit.left + hit.right) / 2,
      y: (hit.top + hit.bottom) / 2,
    }
    return under >= CHANDELIER_CROWD && hasLineOfSight(level, at, aim)
      ? Option.some(aim)
      : Option.none()
  })
})

export const HuntStep = UiSchema.TaggedEnum({
  Leave: {},
  Fetch: {},
  Light: {},
  Open: { exit: ExitId, price: Schema.Finite },
  Save: { exit: ExitId, short: Schema.Finite },
  Done: {},
})
export type HuntStep = typeof HuntStep.Type

const roomExitOf = (level: Level, roomId: string): Option.Option<ExitId> =>
  Option.flatMap(
    Array.findFirst(level.spec.rooms, room => room.id === roomId),
    room => room.maybeExit,
  )

const withRequired = (level: Level, exit: ExitId): ReadonlyArray<ExitId> =>
  Option.match(
    Array.findFirst(level.exits, ({ id }) => id === exit),
    {
      onNone: () => [exit],
      onSome: ({ requires }) => [
        ...Array.flatMap(
          Array.filter(
            requires,
            (required: ExitId) => !Array.contains(level.openExits, required),
          ),
          (required: ExitId) => withRequired(level, required),
        ),
        exit,
      ],
    },
  )

const shutWays = (world: World): ReadonlyArray<ReadonlyArray<ExitId>> => {
  const level = levelOf(world)
  return Array.flatMap(world.dareThings, thing =>
    Option.toArray(
      Option.map(
        Option.flatMap(
          Option.filter(maybeThingRoom(thing, level), ({ isOpen }) => !isOpen),
          ({ id }) => roomExitOf(level, id),
        ),
        exit => withRequired(level, exit),
      ),
    ),
  )
}

export const shutExitsOnTheList = (world: World): ReadonlyArray<ExitId> =>
  Array.dedupe(Array.flatten(shutWays(world)))

export const maybeNextPadlock = (
  world: World,
): Option.Option<Readonly<{ exit: ExitId; price: number }>> =>
  Array.reduce(
    shutWays(world),
    Option.none<Readonly<{ exit: ExitId; price: number }>>(),
    (best, way) =>
      Option.match(Array.head(way), {
        onNone: () => best,
        onSome: exit => {
          const price = exitPriceFor(world, exit)
          return Option.isNone(best) || price < best.value.price
            ? Option.some({ exit, price })
            : best
        },
      }),
  )

export const huntPlan: {
  (from: Vector): (world: World) => HuntStep
  (world: World, from: Vector): HuntStep
} = Function.dual(2, (world: World, from: Vector): HuntStep => {
  if (isFrontDoorOpen(world)) {
    return HuntStep.Leave()
  }
  const things = lyingThings(world)
  if (nearestLit(from, things) !== undefined) {
    return HuntStep.Fetch()
  }
  if (isDarkThingLeft(things)) {
    return HuntStep.Light()
  }
  const maybeNext = maybeNextPadlock(world)
  return Option.match(maybeNext, {
    onNone: () => HuntStep.Done(),
    onSome: ({ exit, price }) =>
      heldKeys(world) >= price
        ? HuntStep.Open({ exit, price })
        : HuntStep.Save({ exit, short: price - heldKeys(world) }),
  })
})
