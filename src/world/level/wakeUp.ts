import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { DOOR_SPAWN_SPREAD_PX, PACK_WARNING_MS } from '#shared/constants.ts'
import { type Seeded, nextRandom } from '#shared/prng.ts'
import { playerCountOf } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  DoorId,
  Phase,
  type PlannedSpawn,
  evolveRoundSpawns,
} from '#world/schema/worldSchema.ts'
import { isFloorKind } from '#world/zombies/zombies.ts'

type WakeRules = Readonly<{
  rushMs: number
  count: number
  perExtraPlayer: number
  packBase: number
}>

export const WAKE_RULES: WakeRules = {
  rushMs: 10_000,
  count: 6,
  perExtraPlayer: 1,
  packBase: 900_000,
}

const PLAIN_GUEST: Omit<PlannedSpawn, 'atMs' | 'door' | 'offset' | 'pack'> = {
  kind: 'Shambler',
  speedScale: 1,
  hpScale: 1,
  formation: 'Trickle',
}

const isWakeTemplate = (spawn: PlannedSpawn): boolean =>
  !isFloorKind(spawn.kind) && spawn.kind !== 'Boss'

const packOfDoor = (door: DoorId): number =>
  WAKE_RULES.packBase +
  Option.getOrElse(
    Array.findFirstIndex(DoorId.literals, id => id === door),
    () => 0,
  )

export const isWakePack = (pack: number): boolean => pack >= WAKE_RULES.packBase

const drawIndex = (state: number, length: number): Seeded<number> => {
  const draw = nextRandom(state)
  return [draw.nextState, Math.min(length - 1, Math.floor(draw.value * length))]
}

const rushSpawns = (
  state: number,
  templates: ReadonlyArray<PlannedSpawn>,
  doors: Array.NonEmptyReadonlyArray<DoorId>,
  count: number,
  startMs: number,
): Seeded<ReadonlyArray<PlannedSpawn>> =>
  Array.mapAccum(
    Array.makeBy(count, index => index),
    state,
    (current, index): readonly [number, PlannedSpawn] => {
      const [pickState, pick] = drawIndex(
        current,
        Math.max(1, templates.length),
      )
      const offsetDraw = nextRandom(pickState)
      const door = Option.getOrElse(
        Array.get(doors, index % doors.length),
        () => Array.headNonEmpty(doors),
      )
      const template = Option.getOrElse(Array.get(templates, pick), () => ({
        ...PLAIN_GUEST,
        atMs: 0,
        door,
        offset: 0,
        pack: 0,
      }))
      return [
        offsetDraw.nextState,
        {
          kind: template.kind,
          speedScale: template.speedScale,
          hpScale: template.hpScale,
          formation: 'Trickle',
          atMs: startMs + Math.round((index * WAKE_RULES.rushMs) / count),
          door,
          offset: Math.round((offsetDraw.value * 2 - 1) * DOOR_SPAWN_SPREAD_PX),
          pack: packOfDoor(door),
        },
      ]
    },
  )

export const wakeRoom: {
  (newDoors: ReadonlyArray<DoorId>): (world: World) => World
  (world: World, newDoors: ReadonlyArray<DoorId>): World
} = Function.dual(2, (world: World, newDoors: ReadonlyArray<DoorId>): World => {
  if (
    !Phase.isAnyOf(['Preparation', 'Wave'])(world.phase) ||
    !Array.isReadonlyArrayNonEmpty(newDoors)
  ) {
    return world
  }
  const round = world.phase
  const startMs = Phase.isAnyOf(['Wave'])(round)
    ? round.elapsedMs + PACK_WARNING_MS
    : PACK_WARNING_MS
  const count =
    WAKE_RULES.count +
    WAKE_RULES.perExtraPlayer * Math.max(0, playerCountOf(world) - 1)
  const [rngState, rush] = rushSpawns(
    world.rngState,
    Array.filter(round.spawns, isWakeTemplate),
    newDoors,
    count,
    startMs,
  )
  return UiStruct.evolve(world, {
    phase: phase =>
      evolveRoundSpawns(phase, spawns => Array.appendAll(spawns, rush)),
    rngState: () => rngState,
  })
})
