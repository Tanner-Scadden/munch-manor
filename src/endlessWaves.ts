import { Array, Option, Result } from 'effect'

import { DOOR_IDS, PARLOUR } from './arena'
import {
  ENDLESS_ESCORTS_BASE,
  ENDLESS_ESCORTS_PER_WAVE,
  ENDLESS_EXPLODER_WEIGHT_PER_WAVE,
  ENDLESS_HP_PER_WAVE,
  ENDLESS_SPEED_MAX,
  ENDLESS_SPEED_PER_WAVE,
  ENDLESS_TANKS_BASE,
  ENDLESS_WAVES_PER_EXTRA_TANK,
  PINCER_LAG_MAX_MS,
} from './constants'
import { routeSpawns } from './doorRoute'
import { isThroughDoor } from './pacing'
import { type Seeded, nextRandom } from './prng'
import { byHoldTime, bySpawnTime, pairsWithin, rollGroup } from './wavePacks'
import {
  type DoorPattern,
  FINAL_WAVE,
  type KindWeight,
  PARLOUR_DOORS,
  type SpawnGroup,
  WAVE_PLANS,
  type WavePlan,
  anyDoors,
  chuckers,
  crawlers,
  fadeThenRelax,
  fromDoors,
  hordes,
  mixOf,
  only,
  pickOne,
  pincers,
  planFor,
  singles,
  squads,
} from './wavePlans'
import type {
  DoorId,
  Hold,
  PlannedSpawn,
  Trap,
  ZombieKind,
} from './worldSchema'
import { ZOMBIE_KIND_ORDER } from './zombies'

// ENDLESS

export const endlessDepth = (wave: number): number =>
  Math.max(0, wave - FINAL_WAVE)

export const hpScaleFor = (wave: number): number =>
  1 + ENDLESS_HP_PER_WAVE * endlessDepth(wave)

const ENDLESS_CYCLE_SHARES: Array.NonEmptyReadonlyArray<number> = [
  0.3, 0.32, 0.38,
]
const ENDLESS_BUILD_SHARE = 0.55
const ENDLESS_BUILD_MS = 18000
const ENDLESS_PEAK_MS = 7000
const ENDLESS_PEAK_EVERY_MAX_MS = 3000
const ENDLESS_CYCLE_LEAD_MS = 1500
const ENDLESS_CYCLE_MS =
  ENDLESS_BUILD_MS + ENDLESS_PEAK_MS + ENDLESS_CYCLE_LEAD_MS
const ENDLESS_RELAX_MS = 3000
const ENDLESS_RELAX_MIN_MS = 2000
const ENDLESS_RELAX_DROP_PER_WAVE_MS = 100
const ENDLESS_PACK_SIZE_BASE = 4
const ENDLESS_PACK_SIZE_MAX = 7
const ENDLESS_WAVES_PER_PACK_GROWTH = 3
const ENDLESS_HORDE_PACK_SHRINK = 2
const ENDLESS_HORDE_PACK_MIN = 3
const ENDLESS_TANK_LEAD_MS = 1000
const ENDLESS_EARLY_TANK_SHARE = 3

export const endlessTankCount = (wave: number): number =>
  ENDLESS_TANKS_BASE +
  Math.floor(endlessDepth(wave) / ENDLESS_WAVES_PER_EXTRA_TANK)

const ENDLESS_CHUCKERS_BASE = 1
const ENDLESS_WAVES_PER_EXTRA_CHUCKER = 4
const ENDLESS_CRAWLERS_BASE = 1
const ENDLESS_WAVES_PER_EXTRA_CRAWLER = 3
const ENDLESS_CHUCKER_START_MS = ENDLESS_CYCLE_MS + 3000
const ENDLESS_CRAWLER_START_MS = 6000
const ENDLESS_CRAWLER_EVERY_MS = 19000

const endlessChuckerCount = (wave: number): number =>
  ENDLESS_CHUCKERS_BASE +
  Math.floor(endlessDepth(wave) / ENDLESS_WAVES_PER_EXTRA_CHUCKER)

const endlessCrawlerCount = (wave: number): number =>
  ENDLESS_CRAWLERS_BASE +
  Math.floor(endlessDepth(wave) / ENDLESS_WAVES_PER_EXTRA_CRAWLER)

const endlessEscortCount = (wave: number): number =>
  ENDLESS_ESCORTS_BASE + ENDLESS_ESCORTS_PER_WAVE * endlessDepth(wave)

export const endlessZombieCount = (wave: number): number =>
  endlessTankCount(wave) +
  endlessEscortCount(wave) +
  endlessChuckerCount(wave) +
  endlessCrawlerCount(wave)

type EndlessCycle = Readonly<{
  startMs: number
  escorts: number
  tanks: number
  buildDoors: Array.NonEmptyReadonlyArray<DoorId>
  peak: DoorPattern
}>

const peakEveryMs = (volleys: number, lagMs: number): number =>
  Math.min(
    ENDLESS_PEAK_EVERY_MAX_MS,
    (ENDLESS_PEAK_MS - lagMs) / Math.max(1, volleys - 1),
  )

const variedSizes = (size: number): Array.NonEmptyReadonlyArray<number> => [
  size,
  Math.max(1, size - 2),
  size + 1,
  Math.max(1, size - 1),
  size + 2,
]

type Filling = Readonly<{ filled: number }>

const packsOf = (
  count: number,
  sizes: Array.NonEmptyReadonlyArray<number>,
): Array.NonEmptyReadonlyArray<number> => {
  const [, taken] = Array.mapAccum(
    Array.makeBy(Math.max(1, count), index => index),
    { filled: 0 },
    ({ filled }: Filling, index): readonly [Filling, number] => {
      const size = Math.min(
        Option.getOrElse(Array.get(sizes, index % sizes.length), () => 1),
        count - filled,
      )
      return [{ filled: filled + Math.max(0, size) }, Math.max(0, size)]
    },
  )
  return Array.match(
    Array.filter(taken, size => size > 0),
    {
      onEmpty: () => [Math.max(1, count)],
      onNonEmpty: packs => packs,
    },
  )
}

const endlessPeak = (
  cycle: EndlessCycle,
  count: number,
  packSize: number,
  mix: Array.NonEmptyReadonlyArray<KindWeight>,
  doorCount: number,
): SpawnGroup => {
  const startMs = cycle.startMs + ENDLESS_BUILD_MS
  if (cycle.peak === 'All') {
    const packs = packsOf(
      count,
      variedSizes(
        Math.max(ENDLESS_HORDE_PACK_MIN, packSize - ENDLESS_HORDE_PACK_SHRINK),
      ),
    )
    const volleys = Math.ceil(packs.length / doorCount)
    return hordes({
      packs,
      mix,
      startMs,
      everyMs: peakEveryMs(volleys, 0),
    })
  } else {
    const packs = packsOf(count, variedSizes(packSize + 1))
    const volleys = Math.ceil(packs.length / 2)
    return pincers({
      packs,
      mix,
      startMs,
      everyMs: peakEveryMs(volleys, PINCER_LAG_MAX_MS),
    })
  }
}

const endlessCycleGroups = (
  cycle: EndlessCycle,
  packSize: number,
  mix: Array.NonEmptyReadonlyArray<KindWeight>,
  doorCount: number,
): Array.NonEmptyReadonlyArray<SpawnGroup> => {
  const buildCount = Math.round(cycle.escorts * ENDLESS_BUILD_SHARE)
  const buildPacks = packsOf(buildCount, variedSizes(packSize))
  const tankGroups: ReadonlyArray<SpawnGroup> =
    cycle.tanks > 0
      ? [
          pincers({
            packs: singles(cycle.tanks),
            mix: only('Tank'),
            startMs: cycle.startMs + ENDLESS_BUILD_MS - ENDLESS_TANK_LEAD_MS,
            everyMs: ENDLESS_PEAK_EVERY_MAX_MS,
          }),
        ]
      : []
  return [
    squads({
      packs: buildPacks,
      mix,
      from: fromDoors(cycle.buildDoors),
      startMs: cycle.startMs,
      everyMs: ENDLESS_BUILD_MS / buildPacks.length,
    }),
    ...tankGroups,
    endlessPeak(cycle, cycle.escorts - buildCount, packSize, mix, doorCount),
  ]
}

const shareOf = (total: number, share: number): number =>
  Math.round(total * share)

const endlessPlan = (
  state: number,
  wave: number,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Seeded<WavePlan> => {
  const depth = endlessDepth(wave)
  const [doorState, buildDoors] = Array.mapAccum(
    ENDLESS_CYCLE_SHARES,
    state,
    (drawState): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
      const draw = nextRandom(drawState)
      return [draw.nextState, pickOne(pairsWithin(levelDoors), draw.value)]
    },
  )
  const tanks = endlessTankCount(wave)
  const escorts = endlessEscortCount(wave)
  const packSize = Math.min(
    ENDLESS_PACK_SIZE_MAX,
    ENDLESS_PACK_SIZE_BASE + Math.floor(depth / ENDLESS_WAVES_PER_PACK_GROWTH),
  )
  const relaxMs = Math.max(
    ENDLESS_RELAX_MIN_MS,
    ENDLESS_RELAX_MS - ENDLESS_RELAX_DROP_PER_WAVE_MS * depth,
  )
  const lastCycle = ENDLESS_CYCLE_SHARES.length - 1
  const earlyTanks = Math.floor(tanks / ENDLESS_EARLY_TANK_SHARE)
  const earlyEscorts = Array.reduce(
    Array.take(ENDLESS_CYCLE_SHARES, lastCycle),
    0,
    (sum, share) => sum + shareOf(escorts, share),
  )
  const mix = mixOf(3, 2, 2 + ENDLESS_EXPLODER_WEIGHT_PER_WAVE * depth)
  const cycles = Array.map(
    ENDLESS_CYCLE_SHARES,
    (share, index): EndlessCycle => ({
      startMs: index * ENDLESS_CYCLE_MS,
      escorts:
        index === lastCycle ? escorts - earlyEscorts : shareOf(escorts, share),
      tanks: index === lastCycle ? tanks - earlyTanks * lastCycle : earlyTanks,
      buildDoors: Option.getOrElse(
        Array.get(buildDoors, index),
        () => levelDoors,
      ),
      peak: index === lastCycle ? 'All' : 'Pincer',
    }),
  )
  return [
    doorState,
    {
      speedScale: Math.min(
        ENDLESS_SPEED_MAX,
        Array.lastNonEmpty(WAVE_PLANS).speedScale +
          ENDLESS_SPEED_PER_WAVE * depth,
      ),
      hpScale: hpScaleFor(wave),
      groups: [
        ...Array.flatMap(cycles, cycle =>
          endlessCycleGroups(cycle, packSize, mix, levelDoors.length),
        ),
        chuckers(
          anyDoors(1),
          endlessChuckerCount(wave),
          ENDLESS_CHUCKER_START_MS,
          ENDLESS_BUILD_MS,
        ),
        crawlers({
          count: endlessCrawlerCount(wave),
          startMs: ENDLESS_CRAWLER_START_MS,
          everyMs: ENDLESS_CRAWLER_EVERY_MS,
        }),
      ],
      holds: Array.makeBy(lastCycle, index =>
        fadeThenRelax(
          (index + 1) * ENDLESS_CYCLE_MS - ENDLESS_CYCLE_LEAD_MS,
          relaxMs,
        ),
      ),
    },
  ]
}

const rollPlan = (
  state: number,
  wave: number,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Seeded<WavePlan> =>
  wave > FINAL_WAVE
    ? endlessPlan(state, wave, levelDoors)
    : [state, planFor(wave)]

export type RolledWave = Readonly<{
  spawns: ReadonlyArray<PlannedSpawn>
  holds: ReadonlyArray<Hold>
}>

// NOTE: doors are the level's spawn doors as the wave is rolled. They are
// the parlour's four until the kitchen is open.
export const rollWave = (
  state: number,
  wave: number,
  doors: ReadonlyArray<DoorId> = PARLOUR.doorIds,
): Seeded<RolledWave> => {
  const levelDoors = Array.match(doors, {
    onEmpty: () => PARLOUR_DOORS,
    onNonEmpty: nonEmpty => nonEmpty,
  })
  const [planState, plan] = rollPlan(state, wave, levelDoors)
  const [nextState, groups] = Array.mapAccum(
    plan.groups,
    planState,
    rollGroup(plan, levelDoors),
  )
  return [
    nextState,
    {
      spawns: Array.sort(Array.flatten(groups), bySpawnTime),
      holds: Array.sort(plan.holds, byHoldTime),
    },
  ]
}

export const rollSpawns = (
  state: number,
  wave: number,
  doors: ReadonlyArray<DoorId> = PARLOUR.doorIds,
): Seeded<ReadonlyArray<PlannedSpawn>> => {
  const [nextState, rolled] = rollWave(state, wave, doors)
  return [nextState, rolled.spawns]
}

export type KindCount = Readonly<{ kind: ZombieKind; count: number }>

export type DoorCount = Readonly<{
  door: DoorId
  count: number
  kinds: Array.NonEmptyReadonlyArray<KindCount>
}>

const kindCounts = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<KindCount> =>
  Array.filterMap(ZOMBIE_KIND_ORDER, kind => {
    const count = Array.filter(spawns, spawn => spawn.kind === kind).length
    return count > 0 ? Result.succeed({ kind, count }) : Result.failVoid
  })

// NOTE: zombies that come up through the floor are counted apart from the
// doors, so every door's count is exactly what walks through it.
export const floorCounts = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<KindCount> =>
  kindCounts(Array.filter(spawns, spawn => !isThroughDoor(spawn)))

export const doorCounts = (
  plannedSpawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
  doors: ReadonlyArray<DoorId> = DOOR_IDS,
): ReadonlyArray<DoorCount> => {
  const spawns = routeSpawns(plannedSpawns, traps, [], doors)
  return Array.filterMap(DOOR_IDS, door => {
    const atDoor = Array.filter(
      spawns,
      spawn => isThroughDoor(spawn) && spawn.door === door,
    )
    return Array.match(kindCounts(atDoor), {
      onEmpty: () => Result.failVoid,
      onNonEmpty: kinds =>
        Result.succeed({ door, count: atDoor.length, kinds }),
    })
  })
}
