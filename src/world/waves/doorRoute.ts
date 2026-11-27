import { Array, Function, Option, Result, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { countWork } from '#shared/workCount.ts'
import { barricadedDoors } from '#world/gear/traps.ts'
import type { DoorId } from '#world/schema/entitySchema.ts'
import type { PackDoor, PlannedSpawn, Trap } from '#world/schema/worldSchema.ts'
import { isFloorKind } from '#world/zombies/zombies.ts'

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
  doors: ReadonlySet<DoorId>,
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
    each => doors.has(each),
  )
}

const openDoorFrom = (
  door: DoorId,
  doors: ReadonlySet<DoorId>,
  boarded: ReadonlySet<DoorId>,
  avoid: ReadonlySet<DoorId>,
): DoorId => {
  if (!boarded.has(door)) {
    return door
  }

  const open = Array.filter(
    clockwiseAfter(door, doors),
    each => !boarded.has(each),
  )
  return pipe(
    open,
    Array.findFirst(each => !avoid.has(each)),
    Option.orElse(() => Array.head(open)),
    Option.getOrElse(() => door),
  )
}

const NO_DOORS: ReadonlySet<DoorId> = new Set()

const PACKS_PER_VOLLEY_STRIDE = 10

const volleyOf = (pack: number): number =>
  Math.floor(pack / PACKS_PER_VOLLEY_STRIDE)

type EnteredIndex = ReadonlyMap<number, ReadonlyMap<DoorId, DoorId>>

const enteredIndexes = new WeakMap<ReadonlyArray<PackDoor>, EnteredIndex>()

const NO_ENTRIES: EnteredIndex = new Map()

const enteredIndexOf = (packDoors: ReadonlyArray<PackDoor>): EnteredIndex => {
  if (Array.isReadonlyArrayEmpty(packDoors)) {
    return NO_ENTRIES
  }
  const cached = enteredIndexes.get(packDoors)
  if (cached !== undefined) {
    return cached
  }
  const index = new Map<number, Map<DoorId, DoorId>>()
  for (const { pack, planned, door } of packDoors) {
    const byDoor = index.get(pack) ?? new Map<DoorId, DoorId>()
    index.set(pack, byDoor)
    if (!byDoor.has(planned)) {
      byDoor.set(planned, door)
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
    enteredIndexOf(packDoors).get(spawn.pack)?.get(spawn.door),
  )

const isVolleyMate =
  (spawn: PlannedSpawn) =>
  (pack: number): boolean =>
    pack !== spawn.pack && volleyOf(pack) === volleyOf(spawn.pack)

const mateDoors = (
  spawn: PlannedSpawn,
  spawns: ReadonlyArray<PlannedSpawn>,
  doors: ReadonlySet<DoorId>,
  boarded: ReadonlySet<DoorId>,
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
      } else if (!boarded.has(mate.door)) {
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
  doors: ReadonlySet<DoorId>,
  boarded: ReadonlySet<DoorId>,
  packDoors: ReadonlyArray<PackDoor>,
): DoorId =>
  Option.getOrElse(maybeEnteredDoor(packDoors, spawn), () => {
    if (isFloorKind(spawn.kind) || !boarded.has(spawn.door)) {
      return spawn.door
    } else if (spawn.formation !== 'Pincer') {
      return openDoorFrom(spawn.door, doors, boarded, NO_DOORS)
    }

    const avoid = mateDoors(spawn, spawns, doors, boarded, packDoors)
    return openDoorFrom(
      spawn.door,
      doors,
      boarded,
      new Set(
        Array.isReadonlyArrayEmpty(avoid)
          ? [openDoorFrom(OPPOSITE_DOOR[spawn.door], doors, boarded, NO_DOORS)]
          : avoid,
      ),
    )
  })

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
  const boarded: ReadonlySet<DoorId> = new Set(barricadedDoors(traps))
  if (boarded.size === 0 && Array.isReadonlyArrayEmpty(packDoors)) {
    return spawns
  }

  const doorSet: ReadonlySet<DoorId> = new Set(doors)
  return Array.map(spawns, spawn => {
    const door = routedDoor(spawn, spawns, doorSet, boarded, packDoors)
    return door === spawn.door
      ? spawn
      : UiStruct.evolve(spawn, { door: () => door })
  })
}
