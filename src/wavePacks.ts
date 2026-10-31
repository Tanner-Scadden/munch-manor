import { Array, Option, Order, Result } from 'effect'

import {
  DOOR_SPAWN_SPREAD_PX,
  PINCER_LAG_MAX_MS,
  PINCER_LAG_MIN_MS,
} from './constants'
import { OPPOSITE_DOOR } from './doorRoute'
import { type Seeded, between, nextRandom } from './prng'
import {
  type DoorPattern,
  type SpawnGroup,
  type WavePlan,
  pickKind,
  pickOne,
} from './wavePlans'
import type { DoorId, Formation, Hold, PlannedSpawn } from './worldSchema'

// PACKS

// NOTE: the parlour's pairs come first and in their old order, so a run that
// never opens the kitchen draws the same pairs it always did.
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

type PackPlace = Readonly<{ door: DoorId; delayMs: number }>

type VolleyRolls = Readonly<{ door: number; order: number; lag: number }>

type PatternRules = Readonly<{
  formation: (size: number) => Formation
  packsPerVolley: (doors: ReadonlyArray<DoorId>) => number
  places: (
    doors: Array.NonEmptyReadonlyArray<DoorId>,
    rolls: VolleyRolls,
  ) => ReadonlyArray<PackPlace>
}>

const DOOR_PATTERNS: Readonly<Record<DoorPattern, PatternRules>> = {
  One: {
    formation: size => (size > 1 ? 'Squad' : 'Trickle'),
    packsPerVolley: () => 1,
    places: (doors, rolls) => [
      { door: pickOne(doors, rolls.door), delayMs: 0 },
    ],
  },
  Pincer: {
    formation: () => 'Pincer',
    packsPerVolley: () => 2,
    places: (doors, rolls) => {
      const pair = pickOne(pincerPairs(doors), rolls.door)
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

type Keyed<A> = Readonly<{ key: number; item: A }>

const byKey = <A>(): Order.Order<Keyed<A>> =>
  Order.mapInput(Order.Number, ({ key }: Keyed<A>) => key)

const shuffle = <A>(
  state: number,
  items: Array.NonEmptyReadonlyArray<A>,
): Seeded<Array.NonEmptyReadonlyArray<A>> => {
  const [nextState, keyed] = Array.mapAccum(
    items,
    state,
    (drawState, item): Seeded<Keyed<A>> => {
      const draw = nextRandom(drawState)
      return [draw.nextState, { key: draw.value, item }]
    },
  )
  return [
    nextState,
    Array.map(Array.sort(keyed, byKey<A>()), ({ item }) => item),
  ]
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

const drawDoors = (
  state: number,
  group: SpawnGroup,
  levelDoors: Array.NonEmptyReadonlyArray<DoorId>,
): Seeded<Array.NonEmptyReadonlyArray<DoorId>> => {
  const candidates = groupDoors(group, levelDoors)
  if (group.doorDraw >= candidates.length) {
    return [state, candidates]
  }

  const [nextState, shuffled] = shuffle(state, candidates)
  return [
    nextState,
    Array.match(Array.take(shuffled, Math.max(1, group.doorDraw)), {
      onEmpty: () => candidates,
      onNonEmpty: doors => doors,
    }),
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
    const places = DOOR_PATTERNS[group.pattern].places(doors, {
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

export const rollGroup =
  (plan: WavePlan, levelDoors: Array.NonEmptyReadonlyArray<DoorId>) =>
  (
    state: number,
    group: SpawnGroup,
    groupIndex: number,
  ): Seeded<ReadonlyArray<PlannedSpawn>> => {
    const [doorState, doors] = drawDoors(state, group, levelDoors)
    const [sizeState, sizes] = shuffle(doorState, group.packs)
    const volleySizes = Array.chunksOf(
      sizes,
      Math.max(1, DOOR_PATTERNS[group.pattern].packsPerVolley(doors)),
    )
    const [volleyState, volleys] = Array.mapAccum(
      volleySizes,
      sizeState,
      rollVolley(group, groupIndex, doors),
    )
    const [packState, packs] = Array.mapAccum(
      Array.flatten(volleys),
      volleyState,
      rollPack(group, plan),
    )
    return [packState, Array.flatten(packs)]
  }

export const bySpawnTime = Order.mapInput(
  Order.Number,
  ({ atMs }: PlannedSpawn) => atMs,
)

export const byHoldTime = Order.mapInput(Order.Number, ({ atMs }: Hold) => atMs)
