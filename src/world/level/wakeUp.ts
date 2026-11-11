import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DOOR_SPAWN_SPREAD_PX, PACK_WARNING_MS } from '../../shared/constants'
import { type Seeded, nextRandom } from '../../shared/prng'
import { playerCountOf } from '../party/party'
import type { World } from '../schema/world'
import { DoorId, Phase, type PlannedSpawn } from '../schema/worldSchema'
import { isFloorKind } from '../zombies/zombies'

// Opening a room wakes it (docs/ROOM_RESEARCH.md, "Decided", owner
// 2026-11-10): a short rush of zombies from the opened room's own doors,
// about 10 s, a small crescendo the players set off themselves.
//
// When (decided for layer 21): opened mid-wave, the rush starts once its
// doors have rattled, a pack warning from now; opened in a break, the room
// stirs and the rush comes as the next wave starts, so the break stays a
// breather. Either way the rush is planned spawns on the round's own list,
// so the doors rattle first, the wave cannot clear while any are to come,
// and it rides the co-op wire as every spawn does.
//
// Who wakes: guests drawn from the round's own planned spawns through a
// door (the wave's kinds with its difficulty and crowd scales), on the
// round's seeded generator, so the same run wakes the same rush.

type WakeRules = Readonly<{
  rushMs: number
  count: number
  perExtraPlayer: number
  // NOTE: wake packs' ids start here, one per door, far above any wave's
  // (GROUP_ID_STRIDE groups), so no wave rule ever claims one.
  packBase: number
}>

export const WAKE_RULES: WakeRules = {
  rushMs: 10_000,
  count: 6,
  perExtraPlayer: 2,
  packBase: 900_000,
}

// NOTE: a plain guest, should the round plan nobody through a door.
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

// NOTE: the rush's spawns from `startMs`, spread over its time and dealt
// round the room's doors in turn.
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

// NOTE: wakes the room whose doors just opened: its rush joins the round
// under way, or the coming wave's start in a break. Nothing outside a
// round, and nothing for an opening with no doors of its own (the secret
// shelf).
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
  return modifyFields(world, {
    phase: () =>
      modifyFields(round, { spawns: spawns => Array.appendAll(spawns, rush) }),
    rngState: () => rngState,
  })
})
