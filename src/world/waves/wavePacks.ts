import { Array, Function, Option, Order, Result } from 'effect'
import type { Ordering } from 'effect'

import {
  DOOR_SPAWN_SPREAD_PX,
  PINCER_LAG_MAX_MS,
  PINCER_LAG_MIN_MS,
} from '../../shared/constants'
import { type Seeded, between, nextRandom, shuffle } from '../../shared/prng'
import type {
  DoorId,
  Formation,
  Hold,
  PlannedSpawn,
  ZombieKind,
} from '../schema/worldSchema'
import { OPPOSITE_DOOR } from './doorRoute'
import {
  type DoorPattern,
  type SpawnGroup,
  type WavePlan,
  pickKind,
  pickOne,
} from './wavePlans'

// PACKS

// NOTE: the parlour's pairs come first and in their old order, so a run that
// never opens the kitchen draws the same pairs it always did. No pair names
// the front door, which is never a spawn door.
const DOOR_PAIRS: Array.NonEmptyReadonlyArray<
  Array.NonEmptyReadonlyArray<DoorId>
> = [
  ['North', 'South'],
  ['West', 'East'],
  ['North', 'East'],
  ['West', 'South'],
  ['North', 'West'],
  ['East', 'South'],
  ['Back', 'South'],
  ['Window', 'East'],
  ['Back', 'West'],
  ['Window', 'North'],
  ['WestTop', 'East'],
  ['WestBottom', 'North'],
  ['EastTop', 'South'],
  ['EastBottom', 'West'],
  ['FarTop', 'South'],
  ['FarBottom', 'West'],
]

const isPairWithin =
  (doors: ReadonlyArray<DoorId>) =>
  (pair: ReadonlyArray<DoorId>): boolean =>
    Array.every(pair, door => Array.contains(doors, door))

export const pairsWithin = (
  doors: ReadonlyArray<DoorId>,
): Array.NonEmptyReadonlyArray<Array.NonEmptyReadonlyArray<DoorId>> =>
  Array.match(Array.filter(DOOR_PAIRS, isPairWithin(doors)), {
    onEmpty: () => DOOR_PAIRS,
    onNonEmpty: pairs => pairs,
  })

const isOppositePair = (pair: Array.NonEmptyReadonlyArray<DoorId>): boolean =>
  Option.contains(Array.get(pair, 1), OPPOSITE_DOOR[Array.headNonEmpty(pair)])

const pincerPairs = (
  doors: Array.NonEmptyReadonlyArray<DoorId>,
): Array.NonEmptyReadonlyArray<Array.NonEmptyReadonlyArray<DoorId>> => {
  const within = Array.filter(DOOR_PAIRS, isPairWithin(doors))
  return Array.match(Array.filter(within, isOppositePair), {
    onNonEmpty: pairs => pairs,
    onEmpty: () =>
      Array.match(within, {
        onNonEmpty: pairs => pairs,
        onEmpty: () => [[Array.headNonEmpty(doors)]],
      }),
  })
}

// NOTE: the doors a wave weights 2:1 (src/world/waves/doorWeights.ts): those
// in a standing player's room or a room beside it, fixed when the wave is
// rolled at its break. Every draw lists a near door twice, so a near door is
// twice as likely as a far one. Only a proper part of the candidates is
// weighted: with none near, or all of them, the list and its draws are the
// same as with no weights at all.
export type SpawnDoors = Readonly<{
  all: Array.NonEmptyReadonlyArray<DoorId>
  near: ReadonlyArray<DoorId>
}>

const weighted = <A>(
  items: Array.NonEmptyReadonlyArray<A>,
  isNear: (item: A) => boolean,
): Array.NonEmptyReadonlyArray<A> => {
  const near = Array.filter(items, isNear)
  return near.length > 0 && near.length < items.length
    ? Array.appendAll(items, near)
    : items
}

const isNearDoor =
  (near: ReadonlyArray<DoorId>) =>
  (door: DoorId): boolean =>
    Array.contains(near, door)

type PackPlace = Readonly<{ door: DoorId; delayMs: number }>

type VolleyRolls = Readonly<{ door: number; order: number; lag: number }>

type PatternRules = Readonly<{
  formation: (size: number) => Formation
  packsPerVolley: (doors: ReadonlyArray<DoorId>) => number
  places: (
    doors: Array.NonEmptyReadonlyArray<DoorId>,
    near: ReadonlyArray<DoorId>,
    rolls: VolleyRolls,
  ) => ReadonlyArray<PackPlace>
}>

const DOOR_PATTERNS: Readonly<Record<DoorPattern, PatternRules>> = {
  One: {
    formation: size => (size > 1 ? 'Squad' : 'Trickle'),
    packsPerVolley: () => 1,
    places: (doors, near, rolls) => [
      {
        door: pickOne(weighted(doors, isNearDoor(near)), rolls.door),
        delayMs: 0,
      },
    ],
  },
  Pincer: {
    formation: () => 'Pincer',
    packsPerVolley: () => 2,
    places: (doors, near, rolls) => {
      const pair = pickOne(
        weighted(pincerPairs(doors), candidate =>
          Array.some(candidate, isNearDoor(near)),
        ),
        rolls.door,
      )
      const ordered = rolls.order < 0.5 ? pair : Array.reverse(pair)
      const lagMs = between(rolls.lag, PINCER_LAG_MIN_MS, PINCER_LAG_MAX_MS)
      return Array.map(ordered, (door, index) => ({
        door,
        delayMs: index * lagMs,
      }))
    },
  },
  All: {
    formation: () => 'Horde',
    packsPerVolley: doors => doors.length,
    places: doors => Array.map(doors, door => ({ door, delayMs: 0 })),
  },
}

const groupDoors = (
  group: SpawnGroup,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Array.NonEmptyReadonlyArray<DoorId> =>
  group.isAnyDoor
    ? levelDoors
    : Array.match(
        Array.filter(group.doors, door => Array.contains(levelDoors, door)),
        { onEmpty: () => levelDoors, onNonEmpty: doors => doors },
      )

// NOTE: a near door listed twice is drawn first more often; the dedupe keeps
// each door once, in its first place.
const drawDoors = (
  state: number,
  group: SpawnGroup,
  { all, near }: SpawnDoors,
): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
  const candidates = groupDoors(group, all)
  if (group.doorDraw >= candidates.length) {
    return [state, candidates]
  }

  const [nextState, shuffled] = shuffle(
    state,
    weighted(candidates, isNearDoor(near)),
  )
  return [
    nextState,
    Array.match(
      Array.take(Array.dedupe(shuffled), Math.max(1, group.doorDraw)),
      {
        onEmpty: () => candidates,
        onNonEmpty: doors => doors,
      },
    ),
  ]
}

export const PACK_ID_STRIDE = 10
export const GROUP_ID_STRIDE = 1000

type PackRoll = Readonly<{
  pack: number
  door: DoorId
  startMs: number
  size: number
}>

const rollPack =
  (group: SpawnGroup, plan: WavePlan) =>
  (state: number, { pack, door, startMs, size }: PackRoll) =>
    Array.mapAccum(
      Array.makeBy(size, index => index),
      state,
      (drawState, index): Seeded<PlannedSpawn> => {
        const kindDraw = nextRandom(drawState)
        const offsetDraw = nextRandom(kindDraw.nextState)
        return [
          offsetDraw.nextState,
          {
            atMs: startMs + index * group.packGapMs,
            kind: pickKind(group.mix, kindDraw.value),
            door,
            offset: between(
              offsetDraw.value,
              -DOOR_SPAWN_SPREAD_PX,
              DOOR_SPAWN_SPREAD_PX,
            ),
            speedScale: plan.speedScale,
            hpScale: plan.hpScale,
            pack,
            formation: DOOR_PATTERNS[group.pattern].formation(size),
          },
        ]
      },
    )

const rollVolley =
  (
    group: SpawnGroup,
    groupIndex: number,
    doors: Array.NonEmptyReadonlyArray<DoorId>,
    near: ReadonlyArray<DoorId>,
  ) =>
  (
    state: number,
    sizes: ReadonlyArray<number>,
    volley: number,
  ): Seeded<ReadonlyArray<PackRoll>> => {
    const doorDraw = nextRandom(state)
    const orderDraw = nextRandom(doorDraw.nextState)
    const lagDraw = nextRandom(orderDraw.nextState)
    const jitterDraw = nextRandom(lagDraw.nextState)
    const places = DOOR_PATTERNS[group.pattern].places(doors, near, {
      door: doorDraw.value,
      order: orderDraw.value,
      lag: lagDraw.value,
    })
    const startMs =
      group.startMs +
      volley * group.intervalMs +
      jitterDraw.value * group.jitterMs
    return [
      jitterDraw.nextState,
      Array.filterMap(
        Array.zip(places, sizes),
        ([{ door, delayMs }, size], index) =>
          size > 0
            ? Result.succeed({
                pack:
                  groupIndex * GROUP_ID_STRIDE +
                  volley * PACK_ID_STRIDE +
                  index,
                door,
                startMs: startMs + delayMs,
                size,
              })
            : Result.failVoid,
      ),
    ]
  }

export const rollGroup: {
  (
    spawnDoors: SpawnDoors,
  ): (
    plan: WavePlan,
  ) => (
    state: number,
    group: SpawnGroup,
    groupIndex: number,
  ) => Seeded<ReadonlyArray<PlannedSpawn>>
  (
    plan: WavePlan,
    spawnDoors: SpawnDoors,
  ): (
    state: number,
    group: SpawnGroup,
    groupIndex: number,
  ) => Seeded<ReadonlyArray<PlannedSpawn>>
} = Function.dual(
  2,
  (plan: WavePlan, spawnDoors: SpawnDoors) =>
    (
      state: number,
      group: SpawnGroup,
      groupIndex: number,
    ): Seeded<ReadonlyArray<PlannedSpawn>> => {
      const [doorState, doors] = drawDoors(state, group, spawnDoors)
      const [sizeState, sizes] = shuffle(doorState, group.packs)
      const volleySizes = Array.chunksOf(
        sizes,
        Math.max(1, DOOR_PATTERNS[group.pattern].packsPerVolley(doors)),
      )
      const [volleyState, volleys] = Array.mapAccum(
        volleySizes,
        sizeState,
        rollVolley(group, groupIndex, doors, spawnDoors.near),
      )
      const [packState, packs] = Array.mapAccum(
        Array.flatten(volleys),
        volleyState,
        rollPack(group, plan),
      )
      return [packState, Array.flatMap(Array.flatten(packs), withEscort)]
    },
)

// NOTE: a Big Leaguer never comes alone: three Groaners walk in right behind
// him in his pack, so he always has something to throw. They take no draws
// from the generator, so every other spawn of the wave rolls as before.
export const CHUCKER_ESCORT_SIZE = 3
const CHUCKER_ESCORT_GAP_MS = 280
const CHUCKER_ESCORT_KIND: ZombieKind = 'Shambler'

const withEscort = (spawn: PlannedSpawn): ReadonlyArray<PlannedSpawn> =>
  spawn.kind === 'Thrower'
    ? [
        spawn,
        ...Array.makeBy(CHUCKER_ESCORT_SIZE, index => ({
          ...spawn,
          kind: CHUCKER_ESCORT_KIND,
          atMs: spawn.atMs + (index + 1) * CHUCKER_ESCORT_GAP_MS,
          offset: (index - 1) * DOOR_SPAWN_SPREAD_PX,
        })),
      ]
    : [spawn]

export const bySpawnTime: {
  (that: PlannedSpawn): (self: PlannedSpawn) => Ordering.Ordering
  (self: PlannedSpawn, that: PlannedSpawn): Ordering.Ordering
} = Function.dual(
  2,
  Order.mapInput(Order.Number, ({ atMs }: PlannedSpawn) => atMs),
)

export const byHoldTime: {
  (that: Hold): (self: Hold) => Ordering.Ordering
  (self: Hold, that: Hold): Ordering.Ordering
} = Function.dual(
  2,
  Order.mapInput(Order.Number, ({ atMs }: Hold) => atMs),
)
