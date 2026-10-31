import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Level, boxCenter, distanceToBox, levelOf } from './arena'
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
} from './constants'
import { isFrenzyPack } from './frenzy'
import { bySpawnTime } from './wavePacks'
import type { World } from './world'
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
} from './worldSchema'
import { isFloorKind, isFree, isFusing, isWalking } from './zombies'

// CROWD

export const isAlive = (zombie: Zombie): boolean =>
  isWalking(zombie) || isFusing(zombie)

export const aliveCount = (zombies: ReadonlyArray<Zombie>): number =>
  Array.reduce(zombies, 0, (count, zombie) =>
    isAlive(zombie) ? count + 1 : count,
  )

const isDue = (clockMs: number) => (spawn: PlannedSpawn) =>
  spawn.atMs <= clockMs

// BEATS

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
            pacing: modifyFields(pacing, {
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
  modifyFields(pacing, { beat: () => beat })

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

const isAnnounced = (
  pacing: Pacing,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  Alarm.isAnyOf(['Ringing'])(pacing.alarm) ||
  Array.some(spawns, ({ pack }) => Array.contains(pacing.warnedPacks, pack))

const isRoomQuiet = (
  pacing: Pacing,
  crowd: Crowd,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  crowd.alive === 0 && crowd.waiting === 0 && !isAnnounced(pacing, spawns)

// NOTE: a pack through a door rattles it PACK_WARNING_MS before it walks
// in, and an Ankle Biter has no door, so the hurry leads each by its own tell.
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

// TRICKLE

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
      ? modifyFields(spawn, { atMs: () => clockMs })
      : spawn

// NOTE: a relax in an empty room lets in a straggler or two instead of
// sitting silent: the soonest lone Shambler, Runner, or Kaboomer of the plan
// walks in now. Once RELAX_TRICKLE_MAX have come, or none is left, a quiet
// room ends the relax instead.
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
        pacing: modifyFields(pacing, {
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

// NOTE: The wave clock only runs while the beat is Flowing. Fading and
// Resting stop it, so every planned spawn after a hold waits out the fade and
// the relax on top of its planned time, but for a pack already warned,
// which keeps its time (keepWarnedOnTime). A fade gives up after FADE_MAX_MS so
// a zombie stuck out of reach cannot stall the wave. An empty room with no
// pack at a door is quiet. A relax that turns quiet for RELAX_QUIET_MAX_MS
// trickles in a straggler, then ends, and once the clock flows after
// QUIET_HURRY_MS of quiet it skips ahead to the next pack's warning, never
// past a hold. Only timing changes, never a door or a kind, so the preview
// stays exact.
export const stepBeat = (
  pacing: Pacing,
  clockMs: number,
  worldMs: number,
  crowd: Crowd,
  intensity: number,
  spawns: ReadonlyArray<PlannedSpawn>,
): Paced => {
  const quieted = modifyFields(pacing, {
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
}

export const waitingCount = (
  spawns: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): number => Array.filter(spawns, isDue(clockMs)).length

// TELEGRAPHS

export const warningPoint = (level: Level, door: DoorId): Vector =>
  boxCenter(level.thresholds[door].box)

const firstOfEachPack = (
  spawns: ReadonlyArray<PlannedSpawn>,
): ReadonlyArray<PlannedSpawn> =>
  Array.dedupeWith(spawns, (first, second) => first.pack === second.pack)

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
    Array.contains(warnedPacks, spawn.pack)

const isDueToWarn =
  (warnedPacks: ReadonlyArray<number>, clockMs: number) =>
  (spawn: PlannedSpawn): boolean =>
    spawn.atMs <= clockMs + PACK_WARNING_MS &&
    isThroughDoor(spawn) &&
    !isWarned(warnedPacks)(spawn)

// NOTE: a warned pack keeps its time while the wave clock stands still for
// a fade, a relax, or the boss's entrance: its spawns come stalledMs sooner
// on the clock, so it walks in when its warning ends. Only timing changes,
// never a door or a kind, so the preview stays exact.
export const keepWarnedOnTime = (
  spawns: ReadonlyArray<PlannedSpawn>,
  warnedPacks: ReadonlyArray<number>,
  stalledMs: number,
): ReadonlyArray<PlannedSpawn> =>
  stalledMs <= 0 || Array.isReadonlyArrayEmpty(warnedPacks)
    ? spawns
    : Array.map(spawns, spawn =>
        isThroughDoor(spawn) && isWarned(warnedPacks)(spawn)
          ? modifyFields(spawn, { atMs: atMs => atMs - stalledMs })
          : spawn,
      )

const noPacks: ReadonlyArray<number> = []

// NOTE: the packs due to warn that may not warn yet. While the boss holds
// the wave, none may: he has the floor. Otherwise the alive cap decides:
// every zombie in the room and every one of a warned pack still to come
// takes a place, and a pack warns, in time order, while one is left for its
// first zombie. So a door only rattles for a pack that can come in.
export const packsWaitingToWarn = (
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
  }

  const coming = Array.filter(
    spawns,
    spawn => isThroughDoor(spawn) && isWarned(warnedPacks)(spawn),
  ).length
  return Array.reduce(
    packs,
    { places: ZOMBIE_ALIVE_MAX - zombieCount - coming, waiting: noPacks },
    ({ places, waiting }, { pack }) =>
      places > 0
        ? {
            places:
              places -
              Array.filter(spawns, spawn => spawn.pack === pack).length,
            waiting,
          }
        : { places, waiting: Array.append(waiting, pack) },
  ).waiting
}

// NOTE: a pack waiting to warn stays a whole warning away on the clock, its
// first zombie PACK_WARNING_MS ahead and the rest at their gaps behind it,
// so once it may warn it walks in when the warning ends.
export const delayWaitingPacks = (
  spawns: ReadonlyArray<PlannedSpawn>,
  waiting: ReadonlyArray<number>,
  clockMs: number,
): ReadonlyArray<PlannedSpawn> =>
  Array.isReadonlyArrayEmpty(waiting)
    ? spawns
    : Array.map(spawns, spawn => {
        if (!Array.contains(waiting, spawn.pack)) {
          return spawn
        }
        const firstMs = Array.reduce(spawns, spawn.atMs, (soonest, other) =>
          other.pack === spawn.pack ? Math.min(soonest, other.atMs) : soonest,
        )
        const shiftMs = Math.max(0, clockMs + PACK_WARNING_MS - firstMs)
        return modifyFields(spawn, { atMs: atMs => atMs + shiftMs })
      })

export const warnPacks = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
  routed: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
  waiting: ReadonlyArray<number>,
): World => {
  const warnedPacks = model.pacing.warnedPacks
  const fresh = pipe(
    routed,
    Array.filter(
      spawn =>
        isDueToWarn(warnedPacks, clockMs)(spawn) &&
        !Array.contains(waiting, spawn.pack),
    ),
    firstOfEachPack,
  )
  const frenzied = Array.filter(fresh, spawn =>
    isFrenzyPack(model.frenzyPacks, spawn.pack),
  )
  if (Array.isReadonlyArrayEmpty(fresh)) {
    return model
  }

  return modifyFields(model, {
    pacing: pacing =>
      modifyFields(pacing, {
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
}

export const quietAlarm = (alarm: Alarm, worldMs: number): Alarm =>
  Alarm.match(alarm, {
    Quiet: () => alarm,
    Ringing: ({ remainingMs }) =>
      remainingMs > worldMs
        ? Alarm.Ringing({ remainingMs: remainingMs - worldMs })
        : Alarm.Quiet(),
  })

export const rattlingDoors = (
  routed: ReadonlyArray<PlannedSpawn>,
  warnedPacks: ReadonlyArray<number>,
): ReadonlyArray<DoorId> =>
  pipe(
    routed,
    Array.filter(
      spawn => isThroughDoor(spawn) && Array.contains(warnedPacks, spawn.pack),
    ),
    Array.map(({ door }) => door),
    Array.dedupe,
  )

// DOORWAY CAMPING

const isCampingDoor = (level: Level, player: Vector, door: DoorId): boolean =>
  distanceToBox(player, level.thresholds[door].box) <= DOOR_CAMP_REACH_PX

export const delayCampedPacks = (
  level: Level,
  spawns: ReadonlyArray<PlannedSpawn>,
  routed: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
  worldMs: number,
  players: ReadonlyArray<Vector>,
): ReadonlyArray<PlannedSpawn> => {
  const campedPacks = pipe(
    routed,
    Array.filter(
      spawn =>
        isDue(clockMs)(spawn) &&
        isThroughDoor(spawn) &&
        Array.some(players, player => isCampingDoor(level, player, spawn.door)),
    ),
    Array.map(({ pack }) => pack),
    Array.dedupe,
  )
  return Array.isReadonlyArrayEmpty(campedPacks)
    ? spawns
    : Array.map(spawns, spawn =>
        Array.contains(campedPacks, spawn.pack)
          ? modifyFields(spawn, { atMs: atMs => atMs + worldMs })
          : spawn,
      )
}

// INTENSITY

const isClose =
  (player: Vector) =>
  (zombie: Zombie): boolean =>
    isFree(zombie) &&
    Math.hypot(zombie.x - player.x, zombie.y - player.y) <= INTENSITY_CLOSE_PX

// NOTE: Intensity is a hidden measure of how hard the last few seconds were.
// It never draws from the seeded generator and never changes which zombie
// comes or from which door. It only lengthens a Relax while it is high.
// NOTE: in co-op, `heartsLost` is the whole crew's and a zombie counts as
// close when it is close to any player, so the music rises for everyone
// when anyone is in trouble. One player counts exactly as before.
export const advanceIntensity = (
  intensity: number,
  heartsLost: number,
  zombies: ReadonlyArray<Zombie>,
  players: ReadonlyArray<Vector>,
  deltaMs: number,
): number => {
  const seconds = deltaMs / MS_PER_SECOND
  const close = Array.filter(zombies, zombie =>
    Array.some(players, player => isClose(player)(zombie)),
  ).length
  const decayed = intensity * Math.exp(-INTENSITY_DECAY_PER_SECOND * seconds)
  return Math.min(
    INTENSITY_MAX,
    decayed +
      heartsLost * INTENSITY_PER_HEART +
      close * INTENSITY_PER_CLOSE_ZOMBIE_PER_SECOND * seconds,
  )
}
