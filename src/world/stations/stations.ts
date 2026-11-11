import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { hoistChandelier, isChandelierDown } from '../dining/chandelier'
import { boxCenter, distanceToBox, levelOf } from '../level/arena'
import { spinShelf } from '../library/revolvingShelf'
import { isHeapDown, toppleStack } from '../library/stacks'
import { seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  StationId,
  type StationState,
  type Vector,
} from '../schema/worldSchema'
import { isStationOpen, stationBoxOf, stationCenterOf } from './stationSpots'
import { TOOL_RULES } from './toolRules'
import { DRAIN_SCALE, isStill } from './work'

// Work stations (docs/ROOM_RESEARCH.md, "Decided", owner 2026-11-10):
// every room tool is set up before it fires. A standing player who keeps
// still (a stick nudged a little still counts) within reach of a ready
// station works it, and cannot shoot or stab while they do
// (src/world/step/simulation.ts). Its set-up fills over `setUpMs` and
// drains at half that pace while nobody works it, so a step away pauses it
// and a long walk loses it. Full, it fires its effect and goes on its
// cooldown. In co-op each player working it adds their own share, so two
// set it up in half the time. Every tool is used mid-wave: breaks are for
// catching a breath. The numbers are in TOOL_RULES
// (src/world/stations/toolRules.ts); each tool's effect lives with its
// room:
//
// - the dining room's chandelier cleat winches a fallen chandelier back up
//   (src/world/dining/chandelier.ts);
// - the parlour's gramophone plays a waltz the Groaners dance to
//   (src/world/parlour/gramophone.ts);
// - the library's two leaning stacks topple a heap of books across an
//   aisle (src/world/library/stacks.ts), and its secret shelf, once open,
//   spins (src/world/library/revolvingShelf.ts);
// - the cellar's barrels roll down the corridor (src/world/cellar/
//   barrels.ts), and its bulb's chain lights the dark
//   (src/world/cellar/bulb.ts);
// - the kitchen's soup pot spills a fresh puddle
//   (src/world/kitchen/soupPot.ts).
//
// A tool whose effect lasts reads it off its own station's clock
// (`isToolActive`), so nothing but `stations` rides the wire.

type StationRules = Readonly<{
  // NOTE: whether its effect would do anything now, cooldown aside.
  isReady: (world: World) => boolean
  fire: (world: World) => World
}>

// NOTE: the phase a room tool works in; a bot reads it to know when the
// cellar bulb's chain can be yanked.
export const isInWave = (world: World): boolean =>
  Phase.isAnyOf(['Wave'])(world.phase)

// NOTE: a tool is ready in a wave with its room open; one with nothing
// more to do needs nothing else.
const readyInWave =
  (id: StationId) =>
  (world: World): boolean =>
    isInWave(world) && isStationOpen(levelOf(world), id)

const STATION_RULES: Readonly<Record<StationId, StationRules>> = {
  Cleat: {
    isReady: world => isInWave(world) && isChandelierDown(world),
    fire: hoistChandelier,
  },
  Gramophone: { isReady: readyInWave('Gramophone'), fire: Function.identity },
  NorthStack: {
    isReady: world =>
      readyInWave('NorthStack')(world) && !isHeapDown(world, 'NorthStack'),
    fire: world => toppleStack(world, 'NorthStack'),
  },
  SouthStack: {
    isReady: world =>
      readyInWave('SouthStack')(world) && !isHeapDown(world, 'SouthStack'),
    fire: world => toppleStack(world, 'SouthStack'),
  },
  Shelf: { isReady: readyInWave('Shelf'), fire: spinShelf },
  Barrels: { isReady: readyInWave('Barrels'), fire: Function.identity },
  Bulb: { isReady: readyInWave('Bulb'), fire: Function.identity },
  SoupPot: { isReady: readyInWave('SoupPot'), fire: Function.identity },
}

// NOTE: a station a player could work right now: ready, and off its
// cooldown.
const isWorkable = (world: World, id: StationId): boolean =>
  world.stations[id].cooldownMs <= 0 && STATION_RULES[id].isReady(world)

const isWorkingOn = (world: World, slot: PlayerSlot, id: StationId): boolean =>
  isStill(world, slot) &&
  isWorkable(world, id) &&
  Option.exists(
    stationBoxOf(levelOf(world), id),
    box =>
      distanceToBox(seatStateAt(world, slot).player, box) <=
      TOOL_RULES[id].reachPx,
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
  Option.getOrElse(stationCenterOf(levelOf(world), id), () => ({ x: 0, y: 0 }))

const advanceStation =
  (deltaMs: number) =>
  (world: World, id: StationId): World => {
    const rules = TOOL_RULES[id]
    const state = world.stations[id]
    const workers = workersOf(world, id)
    const workedMs =
      workers > 0
        ? state.workedMs + deltaMs * workers
        : Math.max(0, state.workedMs - deltaMs * DRAIN_SCALE)
    const cooldownMs = Math.max(0, state.cooldownMs - deltaMs)
    const isDone = workedMs >= rules.setUpMs
    // NOTE: a station idle and cool, as most are most frames, leaves the
    // World as it was rather than copy it.
    if (
      !isDone &&
      workedMs === state.workedMs &&
      cooldownMs === state.cooldownMs
    ) {
      return world
    }
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
    return modifyFields(STATION_RULES[id].fire(kept), {
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
        const rules = TOOL_RULES[id]
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
