import { Array, Function, Option } from 'effect'

import { isHiddenInDark } from '../../world/cellar/bulb'
import { findStyleOf, maybeLyingAt } from '../../world/dare/dare'
import { isFrontDoorOpen } from '../../world/dare/finale'
import { FIND_RULES } from '../../world/dare/finds'
import { maybeStash, pantrySpotOf } from '../../world/kitchen/pantry'
import {
  type Box,
  type Level,
  TILE_PLAYER_SOLID,
  distanceToBox,
  hasTileFlag,
  isInsideRoom,
  levelOf,
  tileIndex,
  tileIndexAt,
  tileOfIndex,
} from '../../world/level/arena'
import type { World } from '../../world/schema/world'
import type { Vector } from '../../world/schema/worldSchema'
import { stationBoxOf } from '../../world/stations/stationSpots'
import { isInWave } from '../../world/stations/stations'
import { TOOL_RULES } from '../../world/stations/toolRules'
import { distanceBetween } from '../../world/step/geometry'

// How a bot searches for the dare's list (src/world/dare/dare.ts), read off
// the World alone and shared by the teammate bots
// (src/features/bots/teammateBot.ts) and the balance bot
// (tools/balance/bot/escape.ts). It goes for the nearest thing lying in an
// open room, finds it the way its room asks (src/world/dare/finds.ts):
// walks onto it, or keeps still in reach of a worked one (the trunk, the
// hollow book, the dumbwaiter), and leaves it for the fight with a zombie
// close. The cellar's thing hides in the dark until the bulb's chain is
// yanked (src/world/cellar/bulb.ts), which only a wave allows, so in a
// break the bot leaves it, and in a wave it goes to the chain first. It
// spends no keys: a thing behind boards waits for the player. Besides the
// list, a bot takes the pantry's goodie each round (src/world/kitchen/
// pantry.ts), free for the walk.

// NOTE: how close a zombie may be before a bot leaves a thing for the
// fight, in a wave.
const SAFE_PX = 45

// NOTE: how far inside a reach a bot keeps still, so a step of drift does
// not put it out.
const REACH_SLACK_PX = 2

// NOTE: how far outside a box a bot stands to reach it.
const BESIDE_PX = 5

// STANDING ROOM

// NOTE: a tile a player could stand on: inside the map and not solid to
// players.
export const isStandableTile: {
  (column: number, row: number): (level: Level) => boolean
  (level: Level, column: number, row: number): boolean
} = Function.dual(
  3,
  (level: Level, column: number, row: number): boolean =>
    isInsideRoom(level, column, row) &&
    !hasTileFlag(level, tileIndex(level, column, row), TILE_PLAYER_SOLID),
)

// NOTE: whether a player could stand on the tile under a point.
const isStandableAt = (level: Level, point: Vector): boolean => {
  const { column, row } = tileOfIndex(level, tileIndexAt(level, point))
  return isStandableTile(level, column, row)
}

// NOTE: a floor point beside a box, below it first, then its sides, then
// above, so a bot never pushes into the wall a station or case hangs on.
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

// THE THINGS ON THE FLOOR

// NOTE: a thing lying in an open room, with how its room finds it.
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

// NOTE: one pass, no sorting: this runs for every bot on every tick.
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

// NOTE: the cellar bulb's station while its chain could be yanked now: off
// its cooldown (the game also asks for a wave).
const maybeBulbBox = (world: World): Option.Option<Box> =>
  world.stations.Bulb.cooldownMs > 0
    ? Option.none()
    : stationBoxOf(levelOf(world), 'Bulb')

const isDarkThingLeft = (things: ReadonlyArray<Lying>): boolean =>
  Array.some(things, ({ isDark }) => isDark)

// NOTE: where a bot at `from` goes to search: the nearest lit thing, or in
// a wave with the cellar's thing still dark, beside the bulb's chain.
// Nothing once the front door is open: the way out comes first.
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

// NOTE: whether a bot at `at` may leave the fight to search: no zombie on
// its feet within SAFE_PX.
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

// NOTE: whether a bot at `at` should keep still where it stands: in reach
// of a lit thing its room finds by work, or, in a wave with the cellar's
// thing still dark, beside the bulb's chain.
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

// THE PANTRY

// NOTE: where the pantry's goodie waits this round, for a bot to walk onto:
// a key for the crew's ring, or a heart for a hurt taker.
export const pantryErrand = (world: World): Vector | undefined =>
  Option.getOrUndefined(
    Option.flatMap(maybeStash(world), () => pantrySpotOf(levelOf(world))),
  )
