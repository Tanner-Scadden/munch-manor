import { Array, Option, pipe } from 'effect'

import { DOOR_IDS } from './arena'
import {
  FADE_RELEASE_BELOW,
  HORDE_GAP_MS,
  PACK_GAP_MS,
  SPAWN_JITTER_MS,
  STRAGGLER_JITTER_MS,
} from './constants'
import type { DoorId, Hold, ZombieKind } from './worldSchema'
import { ZOMBIE_KIND_ORDER } from './zombies'

// SPAWN TABLES

export type KindWeight = Readonly<{ kind: ZombieKind; weight: number }>

export type DoorPattern = 'One' | 'Pincer' | 'All'

// NOTE: A group's packs are its pack sizes. Their order is shuffled per run,
// so a wave mixes singles, pairs, and squads differently every time while its
// zombie count stays the same. doorDraw doors are drawn from doors once per
// run, so a group's doors change from run to run too.
// NOTE: a group that may use any door names no doors of its own. Its doors
// are the level's spawn doors when the wave is rolled, so the kitchen's back
// door and window join every such group once the kitchen is open.
export type SpawnGroup = Readonly<{
  count: number
  packs: Array.NonEmptyReadonlyArray<number>
  packGapMs: number
  pattern: DoorPattern
  mix: Array.NonEmptyReadonlyArray<KindWeight>
  doors: Array.NonEmptyReadonlyArray<DoorId>
  isAnyDoor: boolean
  doorDraw: number
  startMs: number
  intervalMs: number
  jitterMs: number
}>

export type WavePlan = Readonly<{
  speedScale: number
  hpScale: number
  groups: Array.NonEmptyReadonlyArray<SpawnGroup>
  holds: ReadonlyArray<Hold>
}>

// NOTE: the parlour's doors, which every run has. A wave rolled while the
// kitchen is shut uses exactly these.
export const PARLOUR_DOORS: Array.NonEmptyReadonlyArray<DoorId> = [
  'North',
  'West',
  'East',
  'South',
]

export const only = (
  kind: ZombieKind,
): Array.NonEmptyReadonlyArray<KindWeight> => [{ kind, weight: 1 }]

export const mixOf = (
  shamblers: number,
  runners: number,
  exploders: number,
): Array.NonEmptyReadonlyArray<KindWeight> => [
  { kind: 'Shambler', weight: shamblers },
  { kind: 'Runner', weight: runners },
  { kind: 'Exploder', weight: exploders },
]

type DoorChoice = Readonly<{
  doors: Array.NonEmptyReadonlyArray<DoorId>
  isAnyDoor: boolean
  draw: number
}>

export const fromDoors = (
  doors: Array.NonEmptyReadonlyArray<DoorId>,
): DoorChoice => ({
  doors,
  isAnyDoor: false,
  draw: doors.length,
})

const through = (...doors: Array.NonEmptyReadonlyArray<DoorId>): DoorChoice =>
  fromDoors(doors)

export const anyDoors = (draw: number): DoorChoice => ({
  doors: PARLOUR_DOORS,
  isAnyDoor: true,
  draw,
})

const EVERY_DOOR = anyDoors(DOOR_IDS.length)

type GroupSpec = Readonly<{
  packs: Array.NonEmptyReadonlyArray<number>
  mix: Array.NonEmptyReadonlyArray<KindWeight>
  from: DoorChoice
  startMs: number
  everyMs: number
}>

const sumOf = (sizes: ReadonlyArray<number>): number =>
  Array.reduce(sizes, 0, (sum, size) => sum + size)

export const squads = ({
  packs,
  mix,
  from,
  startMs,
  everyMs,
}: GroupSpec): SpawnGroup => ({
  count: sumOf(packs),
  packs,
  packGapMs: PACK_GAP_MS,
  pattern: 'One',
  mix,
  doors: from.doors,
  isAnyDoor: from.isAnyDoor,
  doorDraw: from.draw,
  startMs,
  intervalMs: everyMs,
  jitterMs: SPAWN_JITTER_MS,
})

export const singles = (count: number): Array.NonEmptyReadonlyArray<number> =>
  Array.makeBy(Math.max(1, count), () => 1)

type TrickleSpec = Omit<GroupSpec, 'packs'> & Readonly<{ count: number }>

const trickle = (spec: TrickleSpec): SpawnGroup =>
  squads({ ...spec, packs: singles(spec.count) })

const stragglers = (spec: Omit<TrickleSpec, 'from'>): SpawnGroup => ({
  ...trickle({ ...spec, from: EVERY_DOOR }),
  jitterMs: STRAGGLER_JITTER_MS,
})

export const pincers = (spec: Omit<GroupSpec, 'from'>): SpawnGroup => ({
  ...squads({ ...spec, from: EVERY_DOOR }),
  pattern: 'Pincer',
})

export const hordes = (spec: Omit<GroupSpec, 'from'>): SpawnGroup => ({
  ...squads({ ...spec, from: EVERY_DOOR }),
  packGapMs: HORDE_GAP_MS,
  pattern: 'All',
})

const lug = (from: DoorChoice, atMs: number): SpawnGroup =>
  trickle({ count: 1, mix: only('Tank'), from, startMs: atMs, everyMs: 0 })

export const chuckers = (
  from: DoorChoice,
  count: number,
  atMs: number,
  everyMs: number,
): SpawnGroup =>
  trickle({ count, mix: only('Thrower'), from, startMs: atMs, everyMs })

// NOTE: an Ankle Biter comes up through the floor, so its door is never
// used. It still gets one, drawn like a straggler's, so the plan stays one
// shape. The door preview counts it as FLOOR instead.
export const crawlers = (
  spec: Omit<TrickleSpec, 'from' | 'mix'>,
): SpawnGroup => ({
  ...trickle({ ...spec, mix: only('Crawler'), from: anyDoors(1) }),
  jitterMs: STRAGGLER_JITTER_MS,
})

const lugPincer = (atMs: number): SpawnGroup =>
  pincers({ packs: [1, 1], mix: only('Tank'), startMs: atMs, everyMs: 0 })

export const fadeThenRelax = (atMs: number, relaxMs: number): Hold => ({
  atMs,
  releaseBelow: FADE_RELEASE_BELOW,
  relaxMs,
})

const MIXED = mixOf(3, 2, 1.5)

// NOTE: Each wave is two or three cycles of Build, Peak, Fade, and Relax. A
// hold stops the wave clock at its time until fewer than its threshold are
// alive, then rests for its relax time, so the times of every later group
// are on that paused clock. A kind's first wave brings it in a group of only
// that kind, so the NEW card never promises a zombie the roll left out.
export const WAVE_PLANS: Array.NonEmptyReadonlyArray<WavePlan> = [
  {
    speedScale: 1.0,
    hpScale: 1,
    groups: [
      trickle({
        count: 4,
        mix: only('Shambler'),
        from: through('North'),
        startMs: 1500,
        everyMs: 3000,
      }),
      squads({
        packs: [2],
        mix: only('Shambler'),
        from: through('North'),
        startMs: 14500,
        everyMs: 0,
      }),
    ],
    holds: [],
  },
  {
    speedScale: 1.07,
    hpScale: 1,
    groups: [
      squads({
        packs: [2, 3, 1, 3, 3, 3],
        mix: only('Shambler'),
        from: anyDoors(2),
        startMs: 1200,
        everyMs: 2800,
      }),
      squads({
        packs: [2, 1, 2, 2, 1],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 18700,
        everyMs: 2600,
      }),
      squads({
        packs: [3, 2, 3],
        mix: mixOf(3, 1, 0),
        from: anyDoors(2),
        startMs: 21000,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(17500, 2000)],
  },
  {
    speedScale: 1.14,
    hpScale: 1,
    groups: [
      stragglers({
        count: 5,
        mix: mixOf(3, 1, 0),
        startMs: 800,
        everyMs: 2600,
      }),
      squads({
        packs: [3, 2, 3, 1, 2, 2],
        mix: mixOf(4, 1, 0),
        from: anyDoors(2),
        startMs: 2000,
        everyMs: 3000,
      }),
      pincers({
        packs: [4, 3, 4, 5],
        mix: only('Shambler'),
        startMs: 17500,
        everyMs: 4000,
      }),
      squads({
        packs: [3, 2, 4, 1, 2],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 27700,
        everyMs: 2400,
      }),
      stragglers({
        count: 3,
        mix: mixOf(3, 1, 0),
        startMs: 29000,
        everyMs: 2800,
      }),
    ],
    holds: [fadeThenRelax(26500, 2500)],
  },
  {
    speedScale: 1.21,
    hpScale: 1,
    groups: [
      squads({
        packs: [4, 2, 5, 3, 2],
        mix: mixOf(3, 1, 0),
        from: anyDoors(2),
        startMs: 600,
        everyMs: 3000,
      }),
      trickle({
        count: 3,
        mix: only('Exploder'),
        from: anyDoors(1),
        startMs: 3500,
        everyMs: 3000,
      }),
      pincers({
        packs: [4, 3, 5, 4],
        mix: mixOf(2, 1, 0),
        startMs: 15500,
        everyMs: 4000,
      }),
      squads({
        packs: [4, 2, 4, 3],
        mix: mixOf(2, 0, 1),
        from: anyDoors(3),
        startMs: 26200,
        everyMs: 3000,
      }),
      stragglers({
        count: 3,
        mix: mixOf(2, 1, 1),
        startMs: 27000,
        everyMs: 3500,
      }),
      pincers({
        packs: [4, 4, 4, 3],
        mix: mixOf(2, 1, 1),
        startMs: 38000,
        everyMs: 3000,
      }),
    ],
    holds: [fadeThenRelax(25000, 2500)],
  },
  {
    speedScale: 1.28,
    hpScale: 1,
    groups: [
      squads({
        packs: [3, 4, 2, 3],
        mix: mixOf(3, 2, 1),
        from: anyDoors(2),
        startMs: 1200,
        everyMs: 3500,
      }),
      stragglers({
        count: 3,
        mix: mixOf(3, 1, 0),
        startMs: 6000,
        everyMs: 3000,
      }),
      lug(through('North'), 15500),
      squads({
        packs: [4, 2, 3],
        mix: mixOf(2, 1, 0),
        from: through('North'),
        startMs: 17500,
        everyMs: 2600,
      }),
      squads({
        packs: [4, 6, 3, 5, 2],
        mix: mixOf(3, 2, 1),
        from: anyDoors(2),
        startMs: 27700,
        everyMs: 3300,
      }),
      lug(anyDoors(1), 37000),
      pincers({
        packs: [4, 3, 5, 4],
        mix: MIXED,
        startMs: 43500,
        everyMs: 4000,
      }),
    ],
    holds: [fadeThenRelax(26500, 2500)],
  },
  {
    speedScale: 1.35,
    hpScale: 1,
    groups: [
      stragglers({ count: 2, mix: MIXED, startMs: 500, everyMs: 1600 }),
      chuckers(anyDoors(1), 2, 4500, 16000),
      squads({
        packs: [3, 5, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 2000,
        everyMs: 3800,
      }),
      lug(anyDoors(1), 14000),
      pincers({
        packs: [5, 5, 6, 5],
        mix: MIXED,
        startMs: 15500,
        everyMs: 3500,
      }),
      squads({
        packs: [4, 2, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 27200,
        everyMs: 3000,
      }),
      stragglers({ count: 3, mix: MIXED, startMs: 29000, everyMs: 3000 }),
      lug(anyDoors(1), 35000),
      hordes({
        packs: [3, 3, 4, 3],
        mix: MIXED,
        startMs: 40000,
        everyMs: 0,
      }),
    ],
    holds: [fadeThenRelax(26000, 3000)],
  },
  {
    speedScale: 1.39,
    hpScale: 1.1,
    groups: [
      crawlers({ count: 3, startMs: 7000, everyMs: 9000 }),
      chuckers(anyDoors(1), 1, 30000, 0),
      squads({
        packs: [2, 4, 3, 1, 2],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 1000,
        everyMs: 3200,
      }),
      lug(anyDoors(1), 15500),
      pincers({ packs: [4, 3], mix: MIXED, startMs: 17000, everyMs: 0 }),
      squads({
        packs: [3, 2, 1],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 21000,
        everyMs: 2800,
      }),
      squads({
        packs: [4, 3, 5],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 29200,
        everyMs: 3000,
      }),
      stragglers({
        count: 11,
        mix: mixOf(3, 1, 0),
        startMs: 33000,
        everyMs: 1300,
      }),
      squads({
        packs: [2, 2],
        mix: mixOf(3, 1, 0),
        from: anyDoors(1),
        startMs: 38000,
        everyMs: 1500,
      }),
      lug(anyDoors(1), 46200),
      pincers({
        packs: [4, 2, 3, 3],
        mix: MIXED,
        startMs: 47200,
        everyMs: 3500,
      }),
    ],
    holds: [
      fadeThenRelax(28000, 3000),
      { atMs: 45000, releaseBelow: 4, relaxMs: 2500 },
    ],
  },
  // NOTE: waves 8 and 9 came with the kitchen. Their open groups draw from
  // every spawn door the level has, so once the kitchen is open its back
  // door and window send packs too, and a run that never opens it meets the
  // same waves through the parlour's four doors. Wave 8 is a breather after
  // the Ankle Biters: a long build of squads and lone stragglers from all
  // over, no pincer until the end, and one Big Lug. Wave 9 tests everything
  // before the finale.
  {
    speedScale: 1.4,
    hpScale: 1.1,
    groups: [
      stragglers({ count: 3, mix: MIXED, startMs: 500, everyMs: 1800 }),
      squads({
        packs: [3, 2, 4, 2, 3],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 1500,
        everyMs: 2800,
      }),
      stragglers({
        count: 5,
        mix: mixOf(3, 1, 1),
        startMs: 26000,
        everyMs: 2000,
      }),
      chuckers(anyDoors(1), 1, 9000, 0),
      squads({
        packs: [3, 4, 3, 4],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 15000,
        everyMs: 2600,
      }),
      squads({
        packs: [3, 2, 3],
        mix: mixOf(2, 2, 1),
        from: anyDoors(3),
        startMs: 25000,
        everyMs: 2400,
      }),
      lug(anyDoors(1), 31000),
      pincers({
        packs: [3, 3, 2, 3],
        mix: MIXED,
        startMs: 32000,
        everyMs: 2800,
      }),
    ],
    holds: [fadeThenRelax(24000, 2500)],
  },
  {
    speedScale: 1.42,
    hpScale: 1,
    groups: [
      crawlers({ count: 2, startMs: 6000, everyMs: 12000 }),
      chuckers(anyDoors(1), 1, 12000, 0),
      squads({
        packs: [2, 4, 3, 3],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 800,
        everyMs: 3000,
      }),
      stragglers({
        count: 7,
        mix: mixOf(3, 1, 1),
        startMs: 3000,
        everyMs: 2200,
      }),
      lug(anyDoors(1), 14500),
      pincers({ packs: [4, 4], mix: MIXED, startMs: 16000, everyMs: 0 }),
      squads({
        packs: [3, 2],
        mix: only('Runner'),
        from: anyDoors(1),
        startMs: 19000,
        everyMs: 2300,
      }),
      squads({
        packs: [4, 3, 3],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 29000,
        everyMs: 3000,
      }),
      stragglers({
        count: 4,
        mix: mixOf(3, 1, 1),
        startMs: 31000,
        everyMs: 1600,
      }),
      lug(anyDoors(1), 39000),
      pincers({
        packs: [4, 3, 3, 3],
        mix: MIXED,
        startMs: 40000,
        everyMs: 3200,
      }),
    ],
    holds: [fadeThenRelax(28000, 3000), fadeThenRelax(38500, 2500)],
  },
  {
    speedScale: 1.45,
    hpScale: 1,
    groups: [
      crawlers({ count: 2, startMs: 9000, everyMs: 16000 }),
      chuckers(anyDoors(1), 1, 21000, 0),
      squads({
        packs: [3, 1, 2, 2],
        mix: MIXED,
        from: anyDoors(3),
        startMs: 600,
        everyMs: 2800,
      }),
      pincers({ packs: [3, 3], mix: MIXED, startMs: 11500, everyMs: 0 }),
      squads({
        packs: [3, 1, 2, 2],
        mix: MIXED,
        from: anyDoors(2),
        startMs: 19700,
        everyMs: 2800,
      }),
      lugPincer(28500),
      pincers({
        packs: [3, 2, 3, 2],
        mix: MIXED,
        startMs: 30000,
        everyMs: 3000,
      }),
      stragglers({
        count: 4,
        mix: only('Runner'),
        startMs: 39700,
        everyMs: 1500,
      }),
      lug(anyDoors(1), 45000),
      stragglers({ count: 1, mix: MIXED, startMs: 45000, everyMs: 0 }),
      hordes({
        packs: [3, 2, 3, 2],
        mix: MIXED,
        startMs: 46000,
        everyMs: 2500,
      }),
    ],
    holds: [fadeThenRelax(18500, 2500), fadeThenRelax(38500, 3000)],
  },
]

export const FINAL_WAVE = WAVE_PLANS.length

export const planFor = (wave: number): WavePlan =>
  Option.getOrElse(Array.get(WAVE_PLANS, wave - 1), () =>
    Array.lastNonEmpty(WAVE_PLANS),
  )

const kindsInPlan = (plan: WavePlan): ReadonlyArray<ZombieKind> =>
  pipe(
    plan.groups,
    Array.flatMap(({ mix }) => mix),
    Array.filter(({ weight }) => weight > 0),
    Array.map(({ kind }) => kind),
  )

export const debutKinds = (wave: number): ReadonlyArray<ZombieKind> => {
  if (wave > FINAL_WAVE) {
    return []
  }

  const earlier = Array.flatMap(
    Array.take(WAVE_PLANS, Math.max(0, wave - 1)),
    kindsInPlan,
  )
  const present = kindsInPlan(planFor(wave))
  return Array.filter(
    ZOMBIE_KIND_ORDER,
    kind => Array.contains(present, kind) && !Array.contains(earlier, kind),
  )
}

export const pickOne = <A>(
  items: Array.NonEmptyReadonlyArray<A>,
  roll: number,
): A =>
  Option.getOrElse(Array.get(items, Math.floor(roll * items.length)), () =>
    Array.headNonEmpty(items),
  )

type KindPick = Readonly<{
  reached: number
  maybeKind: Option.Option<ZombieKind>
}>

const NOTHING_PICKED: KindPick = { reached: 0, maybeKind: Option.none() }

export const pickKind = (
  mix: Array.NonEmptyReadonlyArray<KindWeight>,
  roll: number,
): ZombieKind => {
  const total = Array.reduce(mix, 0, (sum, { weight }) => sum + weight)
  const target = roll * total
  const picked = Array.reduce(
    mix,
    NOTHING_PICKED,
    ({ reached, maybeKind }, { kind, weight }): KindPick => ({
      reached: reached + weight,
      maybeKind:
        Option.isNone(maybeKind) && target < reached + weight
          ? Option.some(kind)
          : maybeKind,
    }),
  )
  return Option.getOrElse(picked.maybeKind, () => Array.lastNonEmpty(mix).kind)
}
