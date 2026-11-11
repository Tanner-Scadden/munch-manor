import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { hoistChandelier, isChandelierDown } from '../dining/chandelier'
import {
  type Box,
  type Level,
  boxCenter,
  distanceToBox,
  levelOf,
  tileBox,
} from '../level/arena'
import { type LevelSpec, roomSpotsOf } from '../level/plan'
import { isStanding, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  StationId,
  type StationState,
  type Vector,
} from '../schema/worldSchema'

// Work stations (docs/ROOM_RESEARCH.md, "Decided", owner 2026-11-10):
// every room tool is set up before it fires. A standing player who keeps
// still (a stick nudged a little still counts) within reach of a ready
// station works it, and cannot shoot or stab while they do
// (src/world/step/simulation.ts). Its set-up fills over `setUpMs` and
// drains at half that pace while nobody works it, so a step away pauses it
// and a long walk loses it. Full, it fires its effect and goes on its
// cooldown. In co-op each player working it adds their own share, so two
// set it up in half the time. A tool's rules live here; its effect lives
// with its room.
//
// The first is the dining room's chandelier cleat, `j` on the west wall:
// about 3 s of work in a wave winches a fallen chandelier back up over the
// table's gap, to be shot down on the horde again, then 20 s of cooldown.

type StationRules = Readonly<{
  setUpMs: number
  cooldownMs: number
  reachPx: number
  // NOTE: where the station stands on a level, if the level has it.
  boxOf: (level: Level) => Option.Option<Box>
  // NOTE: whether its effect would do anything now, cooldown aside.
  isReady: (world: World) => boolean
  fire: (world: World) => World
}>

// NOTE: the stick's tilt under which a player still counts as standing.
const STILL_MOVE = 0.2

// NOTE: the share of the set-up pace a station drains at, unworked.
const DRAIN_SCALE = 0.5

const cleatBoxes = new WeakMap<LevelSpec, Option.Option<Box>>()

// NOTE: the cleat's wall tile, read off the dining room's map (`j`). A
// level's spec keeps its box, so a frame only reads it.
const cleatBoxOf = (level: Level): Option.Option<Box> => {
  const cached = cleatBoxes.get(level.spec)
  if (cached !== undefined) {
    return cached
  }
  const box = pipe(
    roomSpotsOf(level.spec),
    Array.flatMap(({ cleats }) => cleats),
    Array.head,
    Option.map(tileBox),
  )
  cleatBoxes.set(level.spec, box)
  return box
}

export const STATION_RULES: Readonly<Record<StationId, StationRules>> = {
  Cleat: {
    setUpMs: 3000,
    cooldownMs: 20_000,
    reachPx: 8,
    boxOf: cleatBoxOf,
    isReady: world =>
      Phase.isAnyOf(['Wave'])(world.phase) && isChandelierDown(world),
    fire: hoistChandelier,
  },
}

export const stationBoxOf: {
  (id: StationId): (level: Level) => Option.Option<Box>
  (level: Level, id: StationId): Option.Option<Box>
} = Function.dual(2, (level: Level, id: StationId): Option.Option<Box> =>
  STATION_RULES[id].boxOf(level),
)

// NOTE: a station a player could work right now: ready, and off its
// cooldown.
const isWorkable = (world: World, id: StationId): boolean =>
  world.stations[id].cooldownMs <= 0 && STATION_RULES[id].isReady(world)

const isStill = (world: World, slot: PlayerSlot): boolean => {
  const { intent, seat } = seatStateAt(world, slot)
  return (
    isStanding(seat) && Math.hypot(intent.move.x, intent.move.y) <= STILL_MOVE
  )
}

const isWorkingOn = (world: World, slot: PlayerSlot, id: StationId): boolean =>
  isStill(world, slot) &&
  isWorkable(world, id) &&
  Option.exists(
    stationBoxOf(levelOf(world), id),
    box =>
      distanceToBox(seatStateAt(world, slot).player, box) <=
      STATION_RULES[id].reachPx,
  )

// NOTE: a player at work on a station holds their fire.
export const isWorkingStation: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean =>
  Array.some(StationId.literals, id => isWorkingOn(world, slot, id)),
)

const workersOf = (world: World, id: StationId): number =>
  Array.length(
    Array.filter(world.seats, ({ seat }) => isWorkingOn(world, seat.slot, id)),
  )

const stationCenter = (world: World, id: StationId): Vector =>
  Option.match(stationBoxOf(levelOf(world), id), {
    onNone: () => ({ x: 0, y: 0 }),
    onSome: boxCenter,
  })

const advanceStation =
  (deltaMs: number) =>
  (world: World, id: StationId): World => {
    const rules = STATION_RULES[id]
    const state = world.stations[id]
    const workers = workersOf(world, id)
    const workedMs =
      workers > 0
        ? state.workedMs + deltaMs * workers
        : Math.max(0, state.workedMs - deltaMs * DRAIN_SCALE)
    const cooldownMs = Math.max(0, state.cooldownMs - deltaMs)
    const isDone = workedMs >= rules.setUpMs
    const next: StationState = isDone
      ? {
          workedMs: 0,
          cooldownMs: rules.cooldownMs,
          timesWorked: state.timesWorked + 1,
        }
      : { workedMs, cooldownMs, timesWorked: state.timesWorked }
    const kept = modifyFields(world, {
      stations: stations => ({ ...stations, [id]: next }),
    })
    if (!isDone) {
      return kept
    }
    const { x, y } = stationCenter(world, id)
    return modifyFields(rules.fire(kept), {
      frameEvents: frameEvents => [
        ...frameEvents,
        GameEvent.StationWorked({ x, y, station: id }),
      ],
    })
  }

// NOTE: one tick of every station: its cooldown, and its set-up from the
// players at work on it.
export const advanceStations: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  Array.reduce(StationId.literals, world, advanceStation(deltaMs)),
)

// THE VIEW

// NOTE: what the client draws of a station: its spot, how far its set-up
// is, how much cooldown is left, and whether it waits to be worked.
export type StationView = Readonly<{
  id: StationId
  center: Vector
  setUp: number
  cooldown: number
  isWorkable: boolean
  timesWorked: number
}>

export const stationViewsOf = (world: World): ReadonlyArray<StationView> => {
  const level = levelOf(world)
  return Array.getSomes(
    Array.map(StationId.literals, id =>
      Option.map(stationBoxOf(level, id), (box): StationView => {
        const rules = STATION_RULES[id]
        const state = world.stations[id]
        return {
          id,
          center: boxCenter(box),
          setUp: Math.min(1, state.workedMs / rules.setUpMs),
          cooldown: Math.min(1, state.cooldownMs / rules.cooldownMs),
          isWorkable: isWorkable(world, id),
          timesWorked: state.timesWorked,
        }
      }),
    ),
  )
}
