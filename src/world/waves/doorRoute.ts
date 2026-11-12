import { Array, Function, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { countWork } from '../../shared/workCount'
import { barricadedDoors } from '../gear/traps'
import type { DoorId } from '../schema/entitySchema'
import type { PackDoor, PlannedSpawn, Trap } from '../schema/worldSchema'
import { isFloorKind } from '../zombies/zombies'

// ORDER

// NOTE: the doors in order around the manor, starting at the top of the
// kitchen. A level that has only some of them goes around the ones it has.
// The front door is never a spawn door, so no pack is ever routed to it: it
// sits after the south door only so the order names every door.
const CLOCKWISE: Array.NonEmptyReadonlyArray<DoorId> = [
  'Back',
  'North',
  'EastTop',
  'FarTop',
  'FarBottom',
  'EastBottom',
  'East',
  'South',
  'Front',
  'WestBottom',
  'WestTop',
  'West',
  'Window',
]

export const OPPOSITE_DOOR: Readonly<Record<DoorId, DoorId>> = {
  North: 'South',
  East: 'West',
  South: 'North',
  West: 'East',
  Back: 'South',
  Window: 'East',
  WestTop: 'East',
  WestBottom: 'North',
  EastTop: 'South',
  EastBottom: 'West',
  FarTop: 'South',
  FarBottom: 'West',
  Front: 'North',
}

const clockwiseAfter = (
  door: DoorId,
  doors: ReadonlyArray<DoorId>,
): ReadonlyArray<DoorId> => {
  const index = Option.getOrElse(
    Array.findFirstIndex(CLOCKWISE, each => each === door),
    () => 0,
  )
  return Array.filter(
    Array.makeBy(
      CLOCKWISE.length - 1,
      step => CLOCKWISE[(index + step + 1) % CLOCKWISE.length] ?? door,
    ),
    // NOTE: at most 13 doors around against the level's 13.
    // oxlint-disable-next-line munch/no-nested-scan
    each => Array.contains(doors, each),
  )
}

// NOTE: a doorway with a standing Plank Pile is no spawn point. A pack due
// there comes through the next open door clockwise, skipping the doors in
// avoid when it can. Two piles at most leave two doors open.
const openDoorFrom = (
  door: DoorId,
  doors: ReadonlyArray<DoorId>,
  boarded: ReadonlyArray<DoorId>,
  avoid: ReadonlyArray<DoorId>,
): DoorId => {
  if (!Array.contains(boarded, door)) {
    return door
  }

  const open = Array.filter(
    clockwiseAfter(door, doors),
    // NOTE: at most 13 doors against the few a barricade boards.
    // oxlint-disable-next-line munch/no-nested-scan
    each => !Array.contains(boarded, each),
  )
  return pipe(
    open,
    // NOTE: at most 13 doors against the few a pack's mates keep.
    // oxlint-disable-next-line munch/no-nested-scan
    Array.findFirst(each => !Array.contains(avoid, each)),
    Option.orElse(() => Array.head(open)),
    Option.getOrElse(() => door),
  )
}

// PACKS

const PACKS_PER_VOLLEY_STRIDE = 10

const volleyOf = (pack: number): number =>
  Math.floor(pack / PACKS_PER_VOLLEY_STRIDE)

// NOTE: the door each warned pack took, by its pack and planned door, the
// first entry winning as a scan would. It is read for every planned spawn,
// so each list gets its index once; the list is replaced, never changed.
const enteredIndexes = new WeakMap<
  ReadonlyArray<PackDoor>,
  ReadonlyMap<string, DoorId>
>()

const enteredKey = (pack: number, planned: DoorId): string =>
  `${pack}|${planned}`

const enteredIndexOf = (
  packDoors: ReadonlyArray<PackDoor>,
): ReadonlyMap<string, DoorId> => {
  const cached = enteredIndexes.get(packDoors)
  if (cached !== undefined) {
    return cached
  }
  const index = new Map<string, DoorId>()
  for (const { pack, planned, door } of packDoors) {
    const key = enteredKey(pack, planned)
    if (!index.has(key)) {
      index.set(key, door)
    }
  }
  enteredIndexes.set(packDoors, index)
  return index
}

const maybeEnteredDoor = (
  packDoors: ReadonlyArray<PackDoor>,
  spawn: Readonly<{ pack: number; door: DoorId }>,
): Option.Option<DoorId> =>
  Option.fromNullishOr(
    enteredIndexOf(packDoors).get(enteredKey(spawn.pack, spawn.door)),
  )

const isVolleyMate =
  (spawn: PlannedSpawn) =>
  (pack: number): boolean =>
    pack !== spawn.pack && volleyOf(pack) === volleyOf(spawn.pack)

// NOTE: a pincer's two packs keep to two different open doors. The earlier
// pack picks first and the later one avoids it, and a pack never takes the
// door its mate keeps. Once a pack has been warned its door is kept, so the
// rattle and the arrival agree.
const mateDoors = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
  doors: ReadonlyArray<DoorId>,
  boarded: ReadonlyArray<DoorId>,
  packDoors: ReadonlyArray<PackDoor>,
): ReadonlyArray<DoorId> => {
  const entered = Array.filter(packDoors, ({ pack }) =>
    isVolleyMate(spawn)(pack),
  )
  const waiting = pipe(
    spawns,
    Array.filter(
      mate =>
        mate.formation === 'Pincer' &&
        isVolleyMate(spawn)(mate.pack) &&
        Option.isNone(maybeEnteredDoor(packDoors, mate)),
    ),
    Array.dedupeWith((first, second) => first.pack === second.pack),
  )
  return [
    ...Array.map(entered, ({ door }) => door),
    ...Array.filterMap(waiting, mate => {
      if (mate.pack < spawn.pack) {
        return Result.succeed(
          routedDoor(mate, spawns, doors, boarded, packDoors),
        )
        // NOTE: one mate's door against the few a barricade boards.
        // oxlint-disable-next-line munch/no-nested-scan
      } else if (!Array.contains(boarded, mate.door)) {
        return Result.succeed(mate.door)
      } else {
        return Result.failVoid
      }
    }),
  ]
}

const routedDoor = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
  doors: ReadonlyArray<DoorId>,
  boarded: ReadonlyArray<DoorId>,
  packDoors: ReadonlyArray<PackDoor>,
): DoorId =>
  Option.getOrElse(maybeEnteredDoor(packDoors, spawn), () => {
    if (isFloorKind(spawn.kind) || !Array.contains(boarded, spawn.door)) {
      return spawn.door
    } else if (spawn.formation !== 'Pincer') {
      return openDoorFrom(spawn.door, doors, boarded, [])
    }

    const avoid = mateDoors(spawn, spawns, doors, boarded, packDoors)
    return openDoorFrom(
      spawn.door,
      doors,
      boarded,
      Array.isReadonlyArrayEmpty(avoid)
        ? [openDoorFrom(OPPOSITE_DOOR[spawn.door], doors, boarded, [])]
        : avoid,
    )
  })

// NOTE: doors are the level's spawn doors, so a pack rerouted from a boarded
// doorway only ever goes to a door that is open on the map.
export const routeSpawns: {
  (
    traps: ReadonlyArray<Trap>,
    packDoors: ReadonlyArray<PackDoor>,
    doors: ReadonlyArray<DoorId>,
  ): (spawns: ReadonlyArray<PlannedSpawn>) => ReadonlyArray<PlannedSpawn>
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    traps: ReadonlyArray<Trap>,
    packDoors: ReadonlyArray<PackDoor>,
    doors: ReadonlyArray<DoorId>,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  4,
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    traps: ReadonlyArray<Trap>,
    packDoors: ReadonlyArray<PackDoor>,
    doors: ReadonlyArray<DoorId>,
  ): ReadonlyArray<PlannedSpawn> => {
    const cached = routesKept.get(spawns)
    if (
      cached?.traps === traps &&
      cached.packDoors === packDoors &&
      cached.doors === doors
    ) {
      return cached.routed
    }
    const routed = routeEach(spawns, traps, packDoors, doors)
    routesKept.set(spawns, { traps, packDoors, doors, routed })
    return routed
  },
)

// NOTE: a route is pure in its inputs and costs a pass over the plan (more
// with a Pincer behind a barricade), and the wave's tick and the break's
// door markers ask again with the same lists, which are replaced, never
// changed. So the last route of each spawn list is kept with its inputs.
const routesKept = new WeakMap<
  ReadonlyArray<PlannedSpawn>,
  Readonly<{
    traps: ReadonlyArray<Trap>
    packDoors: ReadonlyArray<PackDoor>
    doors: ReadonlyArray<DoorId>
    routed: ReadonlyArray<PlannedSpawn>
  }>
>()

const routeEach = (
  spawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
  packDoors: ReadonlyArray<PackDoor>,
  doors: ReadonlyArray<DoorId>,
): ReadonlyArray<PlannedSpawn> => {
  countWork('SpawnRoute')
  const boarded = barricadedDoors(traps)
  if (
    Array.isReadonlyArrayEmpty(boarded) &&
    Array.isReadonlyArrayEmpty(packDoors)
  ) {
    return spawns
  }

  return Array.map(spawns, spawn => {
    const door = routedDoor(spawn, spawns, doors, boarded, packDoors)
    return door === spawn.door
      ? spawn
      : modifyFields(spawn, { door: () => door })
  })
}
