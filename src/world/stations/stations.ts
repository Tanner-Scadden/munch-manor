import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { hoistChandelier, isChandelierDown } from '#world/dining/chandelier.ts'
import { levelOf } from '#world/level/arena.ts'
import { boxCenter, distanceToBox } from '#world/level/tileGrid.ts'
import { spinShelf } from '#world/library/revolvingShelf.ts'
import { isHeapDown, toppleStack } from '#world/library/stacks.ts'
import { seatStateAt } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  GameEvent,
  Phase,
  type PlayerSlot,
  StationId,
  type StationState,
  type Vector,
} from '#world/schema/worldSchema.ts'

import { isStationOpen, stationBoxOf, stationCenterOf } from './stationSpots.ts'
import { TOOL_RULES } from './toolRules.ts'
import { DRAIN_SCALE, isStill } from './work.ts'

type StationRules = Readonly<{
  isReady: (world: World) => boolean
  fire: (world: World) => World
}>

export const isInWave = (world: World): boolean =>
  Phase.isAnyOf(['Wave'])(world.phase)

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

const isWorkable = (world: World, id: StationId): boolean =>
  world.stations[id].cooldownMs <= 0 && STATION_RULES[id].isReady(world)

const isWorkingOn = (world: World, slot: PlayerSlot, id: StationId): boolean =>
  isStill(world, slot) &&
  Option.exists(
    stationBoxOf(levelOf(world), id),
    box =>
      distanceToBox(seatStateAt(world, slot).player, box) <=
      TOOL_RULES[id].reachPx,
  ) &&
  isWorkable(world, id)

export const isWorkingStation: {
  (slot: PlayerSlot): (world: World) => boolean
  (world: World, slot: PlayerSlot): boolean
} = Function.dual(2, (world: World, slot: PlayerSlot): boolean =>
  Array.some(StationId.literals, id => isWorkingOn(world, slot, id)),
)

export const maybeStationWorkOf: {
  (
    slot: PlayerSlot,
  ): (
    world: World,
  ) => Option.Option<Readonly<{ id: StationId; center: Vector; share: number }>>
  (
    world: World,
    slot: PlayerSlot,
  ): Option.Option<Readonly<{ id: StationId; center: Vector; share: number }>>
} = Function.dual(
  2,
  (
    world: World,
    slot: PlayerSlot,
  ): Option.Option<
    Readonly<{ id: StationId; center: Vector; share: number }>
  > =>
    Option.map(
      Array.findFirst(StationId.literals, id => isWorkingOn(world, slot, id)),
      id => ({
        id,
        center: stationCenter(world, id),
        share: Math.min(
          1,
          world.stations[id].workedMs / TOOL_RULES[id].setUpMs,
        ),
      }),
    ),
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
    const kept = UiStruct.evolve(world, {
      stations: stations => ({ ...stations, [id]: next }),
    })
    if (!isDone) {
      return kept
    }
    const { x, y } = stationCenter(world, id)
    return UiStruct.evolve(STATION_RULES[id].fire(kept), {
      frameEvents: frameEvents => [
        ...frameEvents,
        GameEvent.StationWorked({ x, y, station: id }),
      ],
    })
  }

export const advanceStations: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  Array.reduce(StationId.literals, world, advanceStation(deltaMs)),
)

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
