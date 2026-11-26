import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  DINNER_BELL_MS,
  DOOR_CAMP_REACH_PX,
  FADE_MAX_MS,
  INTENSITY_CLOSE_PX,
  INTENSITY_DECAY_PER_SECOND,
  INTENSITY_MAX,
  INTENSITY_PER_CLOSE_ZOMBIE_PER_SECOND,
  INTENSITY_PER_HEART,
  INTENSITY_RESTLESS,
  MS_PER_SECOND,
  PACK_WARNING_MS,
  QUIET_HURRY_MS,
  RELAX_EXTEND_MAX_MS,
  RELAX_QUIET_MAX_MS,
  RELAX_TRICKLE_MAX,
  RESTLESS_QUIET_MAX_MS,
  ZOMBIE_ALIVE_MAX,
} from '../../shared/constants'
import * as DetMath from '../../shared/detMath'
import { sameIfUnchanged } from '../../shared/sameList'
import { type Level, levelOf } from '../level/arena'
import { boxCenter, distanceToBox } from '../level/tileGrid'
import type { World } from '../schema/world'
import {
  Alarm,
  Beat,
  type DoorId,
  GameEvent,
  type Pacing,
  type PlannedSpawn,
  type Vector,
  type Zombie,
  type ZombieKind,
} from '../schema/worldSchema'
import { isFrenzyPack } from '../zombies/frenzy'
import { isFloorKind, isFree, isFusing, isWalking } from '../zombies/zombies'
import { bySpawnTime } from './wavePacks'

export const isAlive = (zombie: Zombie): boolean =>
  isWalking(zombie) || isFusing(zombie)

export const aliveCount = (zombies: ReadonlyArray<Zombie>): number =>
  Array.reduce(zombies, 0, (count, zombie) =>
    isAlive(zombie) ? count + 1 : count,
  )

const isDue = (clockMs: number) => (spawn: PlannedSpawn) =>
  spawn.atMs <= clockMs

type Paced = Readonly<{
  pacing: Pacing
  clockMs: number
  spawns: ReadonlyArray<PlannedSpawn>
}>

type Clocked = Readonly<{ pacing: Pacing; clockMs: number }>

const flow = (pacing: Pacing, clockMs: number, worldMs: number): Clocked =>
  Option.match(Array.head(pacing.holds), {
    onNone: () => ({ pacing, clockMs: clockMs + worldMs }),
    onSome: hold =>
      hold.atMs <= clockMs + worldMs
        ? {
            pacing: UiStruct.evolve(pacing, {
              holds: Array.drop(1),
              beat: () =>
                Beat.Fading({
                  releaseBelow: hold.releaseBelow,
                  relaxMs: hold.relaxMs,
                  waitedMs: 0,
                }),
            }),
            clockMs: Math.max(clockMs, hold.atMs),
          }
        : { pacing, clockMs: clockMs + worldMs },
  })

const withBeat = (pacing: Pacing, beat: Beat): Pacing =>
  UiStruct.evolve(pacing, { beat: () => beat })

const quietCapMs = (intensity: number): number =>
  intensity >= INTENSITY_RESTLESS ? RESTLESS_QUIET_MAX_MS : RELAX_QUIET_MAX_MS

type Rest = Readonly<{
  remainingMs: number
  extendedMs: number
  trickled: number
}>

const count = (rest: Rest, worldMs: number, intensity: number): Beat => {
  if (rest.remainingMs > worldMs) {
    return Beat.Resting({ ...rest, remainingMs: rest.remainingMs - worldMs })
  } else if (
    intensity >= INTENSITY_RESTLESS &&
    rest.extendedMs < RELAX_EXTEND_MAX_MS
  ) {
    return Beat.Resting({
      ...rest,
      remainingMs: 0,
      extendedMs: rest.extendedMs + worldMs,
    })
  } else {
    return Beat.Flowing()
  }
}

type Crowd = Readonly<{ alive: number; waiting: number }>

const hasThinned = (crowd: Crowd, releaseBelow: number): boolean =>
  crowd.waiting === 0 && crowd.alive < releaseBelow

const fade = (
  releaseBelow: number,
  relaxMs: number,
  waitedMs: number,
  crowd: Crowd,
): Beat =>
  hasThinned(crowd, releaseBelow) || waitedMs >= FADE_MAX_MS
    ? Beat.Resting({ remainingMs: relaxMs, extendedMs: 0, trickled: 0 })
    : Beat.Fading({ releaseBelow, relaxMs, waitedMs })

const warnedSets = new WeakMap<ReadonlyArray<number>, ReadonlySet<number>>()

export const isPackWarned: {
  (pack: number): (warnedPacks: ReadonlyArray<number>) => boolean
  (warnedPacks: ReadonlyArray<number>, pack: number): boolean
} = Function.dual(
  2,
  (warnedPacks: ReadonlyArray<number>, pack: number): boolean => {
    const cached = warnedSets.get(warnedPacks)
    if (cached !== undefined) {
      return cached.has(pack)
    }
    const made = new Set(warnedPacks)
    warnedSets.set(warnedPacks, made)
    return made.has(pack)
  },
)

const isAnnounced = (
  pacing: Pacing,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  Alarm.isAnyOf(['Ringing'])(pacing.alarm) ||
  Array.some(spawns, ({ pack }) => isPackWarned(pacing.warnedPacks, pack))

const isRoomQuiet = (
  pacing: Pacing,
  crowd: Crowd,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  crowd.alive === 0 && crowd.waiting === 0 && !isAnnounced(pacing, spawns)

const leadMs = (spawn: PlannedSpawn): number =>
  isThroughDoor(spawn) ? spawn.atMs - PACK_WARNING_MS : spawn.atMs

const nextLeadMs = (
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Option.Option<number> =>
  Array.reduce(spawns, Option.none<number>(), (maybeSoonest, spawn) =>
    spawn.atMs > clockMs
      ? Option.some(
          Option.match(maybeSoonest, {
            onNone: () => leadMs(spawn),
            onSome: soonest => Math.min(soonest, leadMs(spawn)),
          }),
        )
      : maybeSoonest,
  )

const hurryTargetMs = (
  pacing: Pacing,
  clockMs: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): number =>
  Option.match(nextLeadMs(spawns, clockMs), {
    onNone: () => clockMs,
    onSome: lead =>
      Math.max(
        clockMs,
        Option.match(Array.head(pacing.holds), {
          onNone: () => lead,
          onSome: hold => Math.min(hold.atMs, lead),
        }),
      ),
  })

const hurry = (clocked: Clocked, spawns: ReadonlyArray<PlannedSpawn>): Paced =>
  Beat.isAnyOf(['Flowing'])(clocked.pacing.beat) &&
  clocked.pacing.quietMs >= QUIET_HURRY_MS
    ? {
        pacing: clocked.pacing,
        clockMs: hurryTargetMs(clocked.pacing, clocked.clockMs, spawns),
        spawns,
      }
    : { ...clocked, spawns }

export const STRAGGLER_KINDS: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Exploder',
]

const isStraggler =
  (spawns: ReadonlyArray<PlannedSpawn>) =>
  (spawn: PlannedSpawn): boolean =>
    Array.contains(STRAGGLER_KINDS, spawn.kind) &&
    Array.filter(spawns, ({ pack }) => pack === spawn.pack).length === 1

const soonestStraggler = (
  spawns: ReadonlyArray<PlannedSpawn>,
): Option.Option<PlannedSpawn> =>
  Array.reduce(
    Array.filter(spawns, isStraggler(spawns)),
    Option.none<PlannedSpawn>(),
    (maybeSoonest, spawn) =>
      Option.match(maybeSoonest, {
        onNone: () => Option.some(spawn),
        onSome: soonest =>
          spawn.atMs < soonest.atMs ? Option.some(spawn) : maybeSoonest,
      }),
  )

const pulledTo =
  (straggler: PlannedSpawn, clockMs: number) =>
  (spawn: PlannedSpawn): PlannedSpawn =>
    spawn.pack === straggler.pack
      ? UiStruct.evolve(spawn, { atMs: () => clockMs })
      : spawn

const trickle = (
  pacing: Pacing,
  rest: Rest,
  clockMs: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): Paced =>
  pipe(
    soonestStraggler(spawns),
    Option.filter(() => rest.trickled < RELAX_TRICKLE_MAX),
    Option.match({
      onNone: () => ({
        pacing: withBeat(pacing, Beat.Flowing()),
        clockMs,
        spawns,
      }),
      onSome: straggler => ({
        pacing: UiStruct.evolve(pacing, {
          beat: () => Beat.Resting({ ...rest, trickled: rest.trickled + 1 }),
          quietMs: () => 0,
        }),
        clockMs,
        spawns: Array.map(spawns, pulledTo(straggler, clockMs)),
      }),
    }),
  )

const rest = (
  pacing: Pacing,
  restBeat: Rest,
  clockMs: number,
  worldMs: number,
  intensity: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): Paced =>
  pacing.quietMs >= quietCapMs(intensity)
    ? trickle(pacing, restBeat, clockMs, spawns)
    : {
        pacing: withBeat(pacing, count(restBeat, worldMs, intensity)),
        clockMs,
        spawns,
      }

export const stepBeat: {
  (
    clockMs: number,
    worldMs: number,
    crowd: Crowd,
    intensity: number,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): (pacing: Pacing) => Paced
  (
    pacing: Pacing,
    clockMs: number,
    worldMs: number,
    crowd: Crowd,
    intensity: number,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): Paced
} = Function.dual(
  6,
  (
    pacing: Pacing,
    clockMs: number,
    worldMs: number,
    crowd: Crowd,
    intensity: number,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): Paced => {
    const quieted = UiStruct.evolve(pacing, {
      quietMs: quietMs =>
        isRoomQuiet(pacing, crowd, spawns) ? quietMs + worldMs : 0,
    })
    return Beat.match(quieted.beat, {
      Flowing: () => hurry(flow(quieted, clockMs, worldMs), spawns),
      Fading: ({ releaseBelow, relaxMs, waitedMs }) => ({
        pacing: withBeat(
          quieted,
          fade(releaseBelow, relaxMs, waitedMs + worldMs, crowd),
        ),
        clockMs,
        spawns,
      }),
      Resting: ({ remainingMs, extendedMs, trickled }) =>
        rest(
          quieted,
          { remainingMs, extendedMs, trickled },
          clockMs,
          worldMs,
          intensity,
          spawns,
        ),
    })
  },
)

export const waitingCount: {
  (clockMs: number): (spawns: ReadonlyArray<PlannedSpawn>) => number
  (spawns: ReadonlyArray<PlannedSpawn>, clockMs: number): number
} = Function.dual(
  2,
  (spawns: ReadonlyArray<PlannedSpawn>, clockMs: number): number => {
    let waiting = 0
    for (const spawn of spawns) {
      if (spawn.atMs <= clockMs) {
        waiting++
      }
    }
    return waiting
  },
)

export const warningPoint: {
  (door: DoorId): (level: Level) => Vector
  (level: Level, door: DoorId): Vector
} = Function.dual(2, (level: Level, door: DoorId): Vector =>
  boxCenter(level.thresholds[door].box),
)

const firstOfEachPack = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<PlannedSpawn> => {
  const seen = new Set<number>()
  const firsts: Array<PlannedSpawn> = []
  for (const spawn of spawns) {
    if (!seen.has(spawn.pack)) {
      seen.add(spawn.pack)
      firsts.push(spawn)
    }
  }
  return firsts
}

const warnedEvent =
  (level: Level) =>
  (spawn: PlannedSpawn): GameEvent => {
    const { x, y } = warningPoint(level, spawn.door)
    return GameEvent.PackWarned({
      x,
      y,
      door: spawn.door,
      formation: spawn.formation,
    })
  }

const frenziedEvent =
  (level: Level) =>
  (spawn: PlannedSpawn): GameEvent => {
    const { x, y } = warningPoint(level, spawn.door)
    return GameEvent.PackFrenzied({ x, y, door: spawn.door })
  }

export const isThroughDoor = (spawn: PlannedSpawn): boolean =>
  !isFloorKind(spawn.kind)

const ringFor = (alarm: Alarm, warned: ReadonlyArray<PlannedSpawn>): Alarm =>
  Array.some(warned, ({ formation }) => formation === 'Horde')
    ? Alarm.Ringing({ remainingMs: DINNER_BELL_MS })
    : alarm

const plannedDoorOf = (
  spawns: ReadonlyArray<PlannedSpawn>,
  routed: ReadonlyArray<PlannedSpawn>,
  pack: number,
): DoorId =>
  pipe(
    Array.zip(spawns, routed),
    Array.findFirst(([, routedSpawn]) => routedSpawn.pack === pack),
    Option.match({
      onNone: () => 'North',
      onSome: ([spawn]) => spawn.door,
    }),
  )

const isWarned =
  (warnedPacks: ReadonlyArray<number>) =>
  (spawn: PlannedSpawn): boolean =>
    isPackWarned(warnedPacks, spawn.pack)

const isDueToWarn =
  (warnedPacks: ReadonlyArray<number>, clockMs: number) =>
  (spawn: PlannedSpawn): boolean =>
    spawn.atMs <= clockMs + PACK_WARNING_MS &&
    isThroughDoor(spawn) &&
    !isWarned(warnedPacks)(spawn)

export const keepWarnedOnTime: {
  (
    warnedPacks: ReadonlyArray<number>,
    stalledMs: number,
  ): (spawns: ReadonlyArray<PlannedSpawn>) => ReadonlyArray<PlannedSpawn>
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    warnedPacks: ReadonlyArray<number>,
    stalledMs: number,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  3,
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    warnedPacks: ReadonlyArray<number>,
    stalledMs: number,
  ): ReadonlyArray<PlannedSpawn> =>
    stalledMs <= 0 || Array.isReadonlyArrayEmpty(warnedPacks)
      ? spawns
      : sameIfUnchanged(
          spawns,
          Array.map(spawns, spawn =>
            isThroughDoor(spawn) && isWarned(warnedPacks)(spawn)
              ? UiStruct.evolve(spawn, { atMs: atMs => atMs - stalledMs })
              : spawn,
          ),
        ),
)

const noPacks: ReadonlyArray<number> = []

export const packsWaitingToWarn: {
  (
    warnedPacks: ReadonlyArray<number>,
    zombieCount: number,
    clockMs: number,
    isHeld: boolean,
  ): (spawns: ReadonlyArray<PlannedSpawn>) => ReadonlyArray<number>
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    warnedPacks: ReadonlyArray<number>,
    zombieCount: number,
    clockMs: number,
    isHeld: boolean,
  ): ReadonlyArray<number>
} = Function.dual(
  5,
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    warnedPacks: ReadonlyArray<number>,
    zombieCount: number,
    clockMs: number,
    isHeld: boolean,
  ): ReadonlyArray<number> => {
    const packs = pipe(
      spawns,
      Array.filter(isDueToWarn(warnedPacks, clockMs)),
      Array.sort(bySpawnTime),
      firstOfEachPack,
    )
    if (isHeld) {
      return Array.map(packs, ({ pack }) => pack)
    } else if (Array.isReadonlyArrayEmpty(packs)) {
      return noPacks
    }

    let coming = 0
    const sizes = new Map<number, number>()
    for (const spawn of spawns) {
      if (isThroughDoor(spawn) && isWarned(warnedPacks)(spawn)) {
        coming++
      }
      sizes.set(spawn.pack, (sizes.get(spawn.pack) ?? 0) + 1)
    }
    let places = ZOMBIE_ALIVE_MAX - zombieCount - coming
    const waiting: Array<number> = []
    for (const { pack } of packs) {
      if (places > 0) {
        places -= sizes.get(pack) ?? 0
      } else {
        waiting.push(pack)
      }
    }
    return waiting.length === 0 ? noPacks : waiting
  },
)

export const delayWaitingPacks: {
  (
    waiting: ReadonlyArray<number>,
    clockMs: number,
  ): (spawns: ReadonlyArray<PlannedSpawn>) => ReadonlyArray<PlannedSpawn>
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    waiting: ReadonlyArray<number>,
    clockMs: number,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  3,
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    waiting: ReadonlyArray<number>,
    clockMs: number,
  ): ReadonlyArray<PlannedSpawn> => {
    if (Array.isReadonlyArrayEmpty(waiting)) {
      return spawns
    }
    const firsts = new Map<number, number>()
    for (const pack of waiting) {
      firsts.set(pack, Number.POSITIVE_INFINITY)
    }
    for (const spawn of spawns) {
      const first = firsts.get(spawn.pack)
      if (first !== undefined) {
        firsts.set(spawn.pack, Math.min(first, spawn.atMs))
      }
    }
    return sameIfUnchanged(
      spawns,
      Array.map(spawns, spawn => {
        const firstMs = firsts.get(spawn.pack)
        if (firstMs === undefined) {
          return spawn
        }
        const shiftMs = Math.max(0, clockMs + PACK_WARNING_MS - firstMs)
        return UiStruct.evolve(spawn, { atMs: atMs => atMs + shiftMs })
      }),
    )
  },
)

export const warnPacks: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    routed: ReadonlyArray<PlannedSpawn>,
    clockMs: number,
    waiting: ReadonlyArray<number>,
  ): (model: World) => World
  (
    model: World,
    spawns: ReadonlyArray<PlannedSpawn>,
    routed: ReadonlyArray<PlannedSpawn>,
    clockMs: number,
    waiting: ReadonlyArray<number>,
  ): World
} = Function.dual(
  5,
  (
    model: World,
    spawns: ReadonlyArray<PlannedSpawn>,
    routed: ReadonlyArray<PlannedSpawn>,
    clockMs: number,
    waiting: ReadonlyArray<number>,
  ): World => {
    const warnedPacks = model.pacing.warnedPacks
    const held: ReadonlySet<number> = new Set(waiting)
    const fresh = pipe(
      routed,
      Array.filter(
        spawn =>
          isDueToWarn(warnedPacks, clockMs)(spawn) && !held.has(spawn.pack),
      ),
      firstOfEachPack,
    )
    const frenzied = Array.filter(fresh, spawn =>
      isFrenzyPack(model.frenzyPacks, spawn.pack),
    )
    if (Array.isReadonlyArrayEmpty(fresh)) {
      return model
    }

    return UiStruct.evolve(model, {
      pacing: pacing =>
        UiStruct.evolve(pacing, {
          warnedPacks: () => [
            ...warnedPacks,
            ...Array.map(fresh, ({ pack }) => pack),
          ],
          packDoors: packDoors => [
            ...packDoors,
            ...Array.map(fresh, ({ pack, door }) => ({
              pack,
              planned: plannedDoorOf(spawns, routed, pack),
              door,
            })),
          ],
          alarm: alarm => ringFor(alarm, fresh),
        }),
      frameEvents: frameEvents => [
        ...frameEvents,
        ...Array.map(fresh, warnedEvent(levelOf(model))),
        ...Array.map(frenzied, frenziedEvent(levelOf(model))),
      ],
    })
  },
)

export const quietAlarm: {
  (worldMs: number): (alarm: Alarm) => Alarm
  (alarm: Alarm, worldMs: number): Alarm
} = Function.dual(2, (alarm: Alarm, worldMs: number): Alarm =>
  Alarm.match(alarm, {
    Quiet: () => alarm,
    Ringing: ({ remainingMs }) =>
      remainingMs > worldMs
        ? Alarm.Ringing({ remainingMs: remainingMs - worldMs })
        : Alarm.Quiet(),
  }),
)

export const rattlingDoors: {
  (
    warnedPacks: ReadonlyArray<number>,
  ): (routed: ReadonlyArray<PlannedSpawn>) => ReadonlyArray<DoorId>
  (
    routed: ReadonlyArray<PlannedSpawn>,
    warnedPacks: ReadonlyArray<number>,
  ): ReadonlyArray<DoorId>
} = Function.dual(
  2,
  (
    routed: ReadonlyArray<PlannedSpawn>,
    warnedPacks: ReadonlyArray<number>,
  ): ReadonlyArray<DoorId> =>
    pipe(
      routed,
      Array.filter(
        spawn => isThroughDoor(spawn) && isPackWarned(warnedPacks, spawn.pack),
      ),
      Array.map(({ door }) => door),
      Array.dedupe,
    ),
)

const isCampingDoor = (level: Level, player: Vector, door: DoorId): boolean =>
  distanceToBox(player, level.thresholds[door].box) <= DOOR_CAMP_REACH_PX

export const delayCampedPacks: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
    routed: ReadonlyArray<PlannedSpawn>,
    clockMs: number,
    worldMs: number,
    players: ReadonlyArray<Vector>,
  ): (level: Level) => ReadonlyArray<PlannedSpawn>
  (
    level: Level,
    spawns: ReadonlyArray<PlannedSpawn>,
    routed: ReadonlyArray<PlannedSpawn>,
    clockMs: number,
    worldMs: number,
    players: ReadonlyArray<Vector>,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  6,
  (
    level: Level,
    spawns: ReadonlyArray<PlannedSpawn>,
    routed: ReadonlyArray<PlannedSpawn>,
    clockMs: number,
    worldMs: number,
    players: ReadonlyArray<Vector>,
  ): ReadonlyArray<PlannedSpawn> => {
    const isDueNow = isDue(clockMs)
    const dueDoors = new Set<DoorId>()
    for (const spawn of routed) {
      if (isDueNow(spawn) && isThroughDoor(spawn)) {
        dueDoors.add(spawn.door)
      }
    }
    const campedDoors = new Set<DoorId>()
    for (const player of players) {
      for (const door of dueDoors) {
        if (isCampingDoor(level, player, door)) {
          campedDoors.add(door)
        }
      }
    }
    const campedPacks = new Set<number>()
    if (campedDoors.size > 0) {
      for (const spawn of routed) {
        if (
          isDueNow(spawn) &&
          isThroughDoor(spawn) &&
          campedDoors.has(spawn.door)
        ) {
          campedPacks.add(spawn.pack)
        }
      }
    }
    return campedPacks.size === 0
      ? spawns
      : Array.map(spawns, spawn =>
          campedPacks.has(spawn.pack)
            ? UiStruct.evolve(spawn, { atMs: atMs => atMs + worldMs })
            : spawn,
        )
  },
)

const countClose = (
  zombies: ReadonlyArray<Zombie>,
  players: ReadonlyArray<Vector>,
): number => {
  let close = 0
  for (const zombie of zombies) {
    if (isFree(zombie)) {
      for (const player of players) {
        if (
          DetMath.hypot(zombie.x - player.x, zombie.y - player.y) <=
          INTENSITY_CLOSE_PX
        ) {
          close += 1
          break
        }
      }
    }
  }
  return close
}

export const advanceIntensity: {
  (
    heartsLost: number,
    zombies: ReadonlyArray<Zombie>,
    players: ReadonlyArray<Vector>,
    deltaMs: number,
  ): (intensity: number) => number
  (
    intensity: number,
    heartsLost: number,
    zombies: ReadonlyArray<Zombie>,
    players: ReadonlyArray<Vector>,
    deltaMs: number,
  ): number
} = Function.dual(
  5,
  (
    intensity: number,
    heartsLost: number,
    zombies: ReadonlyArray<Zombie>,
    players: ReadonlyArray<Vector>,
    deltaMs: number,
  ): number => {
    const seconds = deltaMs / MS_PER_SECOND
    const close = countClose(zombies, players)
    const decayed =
      intensity * DetMath.exp(-INTENSITY_DECAY_PER_SECOND * seconds)
    return Math.min(
      INTENSITY_MAX,
      decayed +
        heartsLost * INTENSITY_PER_HEART +
        close * INTENSITY_PER_CLOSE_ZOMBIE_PER_SECOND * seconds,
    )
  },
)
