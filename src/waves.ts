import { Array, Option, Order, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { doorSpawnPoint, levelOf } from './arena'
import {
  advanceBossEntrance,
  isBossOutside,
  isWaveHeldByBoss,
  planBoss,
} from './boss'
import { CHUCKER_RULES } from './chucker'
import {
  DOOR_HALF_WIDTH_PX,
  OPEN_BREAK_WAVE,
  PACK_WARNING_MS,
  PREPARATION_MS,
  WAVE_BONUS_BASE,
  WAVE_BONUS_PER_WAVE,
  ZOMBIE_ALIVE_MAX,
} from './constants'
import { burrowed, drawSurfacingSpot } from './crawler'
import { crowdSpawns, toughenSpawns } from './difficulty'
import { routeSpawns } from './doorRoute'
import { rollWave } from './endlessWaves'
import { frenzyOnArrival, frenzyPacksOf } from './frenzy'
import { clamp } from './geometry'
import {
  isPracticeGateHeld,
  isTimedBreak,
  learnOpenBreak,
  learnTimedBreaks,
} from './lessons'
import {
  aliveCount,
  delayCampedPacks,
  delayWaitingPacks,
  isAlive,
  isThroughDoor,
  keepWarnedOnTime,
  packsWaitingToWarn,
  quietAlarm,
  stepBeat,
  waitingCount,
  warnPacks,
} from './pacing'
import {
  isCoop,
  isStanding,
  payShared,
  playerCountOf,
  playersOf,
  targetsOf,
} from './party'
import { type Seeded, nextRandom } from './prng'
import { isEveryoneReady, returnFallen } from './revive'
import { isKitchenTourOn } from './tutorialRules'
import { GROUP_ID_STRIDE, PACK_ID_STRIDE, bySpawnTime } from './wavePacks'
import { FINAL_WAVE, planFor } from './wavePlans'
import { type World, modifyWorldFields } from './world'
import {
  Alarm,
  Beat,
  BreakClock,
  type DoorId,
  GameEvent,
  Phase,
  type PlannedSpawn,
  type Round,
  RunMode,
  ShopState,
  type Vector,
  ZombieAction,
} from './worldSchema'
import {
  ZOMBIE_KINDS,
  arrivingZombie,
  isBoss,
  isFloorKind,
  isWalking,
  scaledHp,
} from './zombies'

export const waveBonus = (wave: number): number =>
  WAVE_BONUS_BASE + WAVE_BONUS_PER_WAVE * wave

// JOINING DOORS

// NOTE: a pack due at least this long from now may move to a door that has
// just opened. Anything sooner keeps its door, so a door never fills the
// moment it opens, and a pack that has already rattled keeps its door too.
export const JOIN_LEAD_MS = PACK_WARNING_MS + 1500

type DoorMove = Readonly<{ pack: number; door: DoorId }>

const groupOfPack = (pack: number): number => Math.floor(pack / GROUP_ID_STRIDE)

const volleyOfPack = (pack: number): number => Math.floor(pack / PACK_ID_STRIDE)

// NOTE: a group that names its doors keeps them, as the roll does. Endless
// groups all draw from the level's doors.
const canPackMove = (wave: number, pack: number): boolean =>
  wave > FINAL_WAVE ||
  Option.exists(
    Array.get(planFor(wave).groups, groupOfPack(pack)),
    ({ isAnyDoor }) => isAnyDoor,
  )

// NOTE: the doors a pack's volley mates come through, so a pincer's two
// packs stay at two doors when one moves.
const mateDoorsOf = (
  spawns: ReadonlyArray<PlannedSpawn>,
  moves: ReadonlyArray<DoorMove>,
  pack: number,
): ReadonlyArray<DoorId> =>
  pipe(
    spawns,
    Array.filter(
      spawn =>
        spawn.pack !== pack && volleyOfPack(spawn.pack) === volleyOfPack(pack),
    ),
    Array.map(spawn =>
      Option.getOrElse(
        Option.map(
          Array.findFirst(moves, move => move.pack === spawn.pack),
          ({ door }) => door,
        ),
        () => spawn.door,
      ),
    ),
  )

const noMoves = (state: number): Seeded<ReadonlyArray<DoorMove>> => [state, []]

const drawMoves = (
  state: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  packs: ReadonlyArray<PlannedSpawn>,
  newDoors: Array.NonEmptyReadonlyArray<DoorId>,
  share: number,
): Seeded<ReadonlyArray<DoorMove>> =>
  Array.reduce(
    packs,
    noMoves(state),
    ([drawState, moves], { pack }): Seeded<ReadonlyArray<DoorMove>> => {
      const moveDraw = nextRandom(drawState)
      if (moveDraw.value >= share) {
        return [moveDraw.nextState, moves]
      }
      const doorDraw = nextRandom(moveDraw.nextState)
      const mates = mateDoorsOf(spawns, moves, pack)
      const choices = Array.match(
        Array.filter(newDoors, door => !Array.contains(mates, door)),
        { onEmpty: () => newDoors, onNonEmpty: doors => doors },
      )
      const door = Option.getOrElse(
        Array.get(choices, Math.floor(doorDraw.value * choices.length)),
        () => Array.headNonEmpty(choices),
      )
      return [doorDraw.nextState, [...moves, { pack, door }]]
    },
  )

const movedSpawns = (
  spawns: ReadonlyArray<PlannedSpawn>,
  moves: ReadonlyArray<DoorMove>,
): ReadonlyArray<PlannedSpawn> =>
  Array.map(spawns, spawn =>
    Option.match(
      Array.findFirst(moves, ({ pack }) => pack === spawn.pack),
      {
        onNone: () => spawn,
        onSome: ({ door }) => modifyFields(spawn, { door: () => door }),
      },
    ),
  )

// NOTE: doors that open while a wave is shown or under way join it at once.
// Each pack still to come, through a door, from a group free to pick its
// door, and due JOIN_LEAD_MS or more from now (any pack, in the break),
// moves to one of the new doors with the share of the doors they now are,
// drawn from the run's generator. Only doors change: every zombie, its kind,
// and its time stay, so the wave's count and pacing hold, and the door
// preview reads the new doors at once.
export const joinNewDoors = (
  model: World,
  newDoors: ReadonlyArray<DoorId>,
): World => {
  if (
    !Phase.isAnyOf(['Preparation', 'Wave'])(model.phase) ||
    !Array.isReadonlyArrayNonEmpty(newDoors)
  ) {
    return model
  }
  const round = model.phase
  const earliestMs = Phase.isAnyOf(['Wave'])(round)
    ? round.elapsedMs + JOIN_LEAD_MS
    : Number.NEGATIVE_INFINITY
  const packs = pipe(
    round.spawns,
    Array.dedupeWith((first, second) => first.pack === second.pack),
    Array.filter(
      spawn =>
        isThroughDoor(spawn) &&
        spawn.atMs >= earliestMs &&
        !Array.contains(model.pacing.warnedPacks, spawn.pack) &&
        canPackMove(round.wave, spawn.pack),
    ),
  )
  const share = newDoors.length / Math.max(1, levelOf(model).doorIds.length)
  const [rngState, moves] = drawMoves(
    model.rngState,
    round.spawns,
    packs,
    newDoors,
    share,
  )
  return modifyFields(model, {
    phase: () =>
      modifyFields(round, {
        spawns: () => movedSpawns(round.spawns, moves),
      }),
    rngState: () => rngState,
  })
}

// PHASES

export const isRoundActive = (phase: Phase): boolean =>
  Phase.isAnyOf(['Preparation', 'Wave'])(phase)

export const isBreak = (model: World): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase)

const breakClockFor = (wave: number): BreakClock =>
  wave === OPEN_BREAK_WAVE
    ? BreakClock.Waiting({ elapsedMs: 0 })
    : BreakClock.Counting()

export const beginPreparation = (
  model: World,
  wave: number,
  durationMs: number,
  clock: BreakClock = BreakClock.Counting(),
): World => {
  const [waveState, rolled] = rollWave(
    model.rngState,
    wave,
    levelOf(model).doorIds,
  )
  const { holds } = rolled
  const spawns = crowdSpawns(
    playerCountOf(model),
    toughenSpawns(model.difficulty.chosen, rolled.spawns),
  )
  const [rngState, boss] = planBoss(
    levelOf(model).doorIds,
    waveState,
    wave,
    spawns,
    model.difficulty.chosen,
  )
  return modifyFields(returnFallen(model), {
    boss: () => boss,
    frenzyPacks: () => frenzyPacksOf(spawns),
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: durationMs,
        durationMs,
        spawns,
        clock,
      }),
    pacing: () => ({
      holds,
      beat: Beat.Flowing(),
      warnedPacks: [],
      packDoors: [],
      alarm: Alarm.Quiet(),
      quietMs: 0,
    }),
    rngState: () => rngState,
  })
}

export const isEndless = (model: World): boolean =>
  RunMode.isAnyOf(['Endless'])(model.mode)

export const pause = <M extends World>(model: M): M =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: preparation =>
      modifyWorldFields(model, {
        phase: () => Phase.Paused({ round: preparation }),
      }),
    Wave: wave =>
      modifyWorldFields(model, { phase: () => Phase.Paused({ round: wave }) }),
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

const learnFromBreak = (model: World, wave: number, clock: BreakClock) =>
  BreakClock.match(clock, {
    Waiting: () => learnOpenBreak(model),
    Counting: () =>
      isTimedBreak(wave, clock) ? learnTimedBreaks(model) : model,
  })

export const startWaveEarly = (model: World): World =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: ({ wave, spawns, clock }) =>
      modifyFields(learnFromBreak(model, wave, clock), {
        phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }),
      }),
    Wave: () => model,
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

// SPAWNING

type Arrival = Readonly<{
  at: Vector
  action: ZombieAction
  rngState: number
  events: ReadonlyArray<GameEvent>
}>

const arrivalAction = (spawn: PlannedSpawn): ZombieAction =>
  spawn.kind === 'Thrower'
    ? ZombieAction.Winded({ remainingMs: CHUCKER_RULES.arrivalWindedMs })
    : ZombieAction.Roaming()

const arriveAt = (model: World, spawn: PlannedSpawn): Arrival => {
  if (isFloorKind(spawn.kind)) {
    const [rngState, at] = drawSurfacingSpot(
      levelOf(model),
      model.rngState,
      model.player,
      model.traps,
    )
    return {
      at,
      action: burrowed(),
      rngState,
      events: [GameEvent.CrawlerStirred({ x: at.x, y: at.y })],
    }
  }

  const doorRoom = Math.max(
    0,
    DOOR_HALF_WIDTH_PX - ZOMBIE_KINDS[spawn.kind].radius,
  )
  return {
    at: doorSpawnPoint(
      levelOf(model),
      spawn.door,
      clamp(spawn.offset, -doorRoom, doorRoom),
    ),
    action: arrivalAction(spawn),
    rngState: model.rngState,
    events: [],
  }
}

const spawnZombie = (model: World, spawn: PlannedSpawn): World => {
  const stats = ZOMBIE_KINDS[spawn.kind]
  const arrival = arriveAt(model, spawn)
  const speedDraw = nextRandom(arrival.rngState)
  const zombie = arrivingZombie({
    id: model.nextEntityId,
    kind: spawn.kind,
    at: arrival.at,
    speedRoll: speedDraw.value,
    speedScale: spawn.speedScale,
    hp: scaledHp(stats.hp, spawn.hpScale),
    action: arrival.action,
    frenzy: frenzyOnArrival(model.frenzyPacks, spawn),
  })
  return modifyFields(model, {
    zombies: Array.append(zombie),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
    frameEvents: frameEvents => [...frameEvents, ...arrival.events],
  })
}

const isWaveCleared = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
): boolean =>
  Array.isReadonlyArrayEmpty(spawns) &&
  !isBossOutside(model.boss) &&
  !Array.some(model.zombies, zombie => isAlive(zombie) || isBoss(zombie))

const payWaveBonus = (model: World, wave: number): World => {
  const bonus = waveBonus(wave)
  return payShared(
    modifyFields(model, {
      frameEvents: Array.append(
        GameEvent.WaveCleared({ x: model.player.x, y: model.player.y, bonus }),
      ),
    }),
    bonus,
  )
}

const clearWave = (model: World, wave: number): World => {
  const paid = payWaveBonus(model, wave)
  if (wave >= FINAL_WAVE && !isEndless(model)) {
    return modifyFields(paid, { phase: () => Phase.Victory() })
  } else {
    return beginPreparation(
      paid,
      wave + 1,
      PREPARATION_MS,
      breakClockFor(wave + 1),
    )
  }
}

// NOTE: spawns stay with their planned doors, so a door whose plank breaks
// is a spawn point again. routed is the same list with each door rerouted
// around the boarded ones, index for index.
const releaseDue = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
  routed: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Readonly<{ model: World; pending: ReadonlyArray<PlannedSpawn> }> => {
  const paired = Array.zip(spawns, routed)
  const due = Array.filter(paired, ([spawn]) => spawn.atMs <= clockMs)
  if (Array.isReadonlyArrayEmpty(due)) {
    return { model, pending: spawns }
  }

  const later = Array.filter(spawns, spawn => spawn.atMs > clockMs)
  const room = Math.max(0, ZOMBIE_ALIVE_MAX - model.zombies.length)
  const [arriving, held] = Array.splitAt(
    Array.sort(
      due,
      Order.mapInput(
        bySpawnTime,
        ([spawn]: readonly [PlannedSpawn, PlannedSpawn]) => spawn,
      ),
    ),
    room,
  )
  return {
    model: Array.reduce(arriving, model, (current, [, routedSpawn]) =>
      spawnZombie(current, routedSpawn),
    ),
    pending: Array.appendAll(
      Array.map(held, ([spawn]) => spawn),
      later,
    ),
  }
}

type WaveRound = Phase & { readonly _tag: 'Wave' }

const advanceWave = (
  model: World,
  round: WaveRound,
  worldMs: number,
): World => {
  const { wave, elapsedMs, spawns } = round
  const pacedMs = isWaveHeldByBoss(model.boss) ? 0 : worldMs
  const paced = stepBeat(
    model.pacing,
    elapsedMs,
    pacedMs,
    {
      alive: aliveCount(model.zombies),
      waiting: waitingCount(spawns, elapsedMs),
    },
    model.intensity,
    spawns,
  )
  const clockMs = paced.clockMs
  const doors = levelOf(model).doorIds
  const onTime = keepWarnedOnTime(
    paced.spawns,
    model.pacing.warnedPacks,
    worldMs - (clockMs - elapsedMs),
  )
  const waitingPacks = packsWaitingToWarn(
    onTime,
    model.pacing.warnedPacks,
    model.zombies.length,
    clockMs,
    isWaveHeldByBoss(model.boss),
  )
  const delayed = delayWaitingPacks(onTime, waitingPacks, clockMs)
  const route = routeSpawns(delayed, model.traps, model.pacing.packDoors, doors)
  const camped = delayCampedPacks(
    levelOf(model),
    delayed,
    route,
    clockMs,
    pacedMs,
    targetsOf(model),
  )
  const warned = warnPacks(
    modifyFields(model, {
      pacing: () =>
        modifyFields(paced.pacing, {
          alarm: alarm => quietAlarm(alarm, worldMs),
        }),
    }),
    camped,
    routeSpawns(camped, model.traps, model.pacing.packDoors, doors),
    clockMs,
    waitingPacks,
  )
  const released = releaseDue(
    warned,
    camped,
    routeSpawns(camped, warned.traps, warned.pacing.packDoors, doors),
    clockMs,
  )
  const entered = advanceBossEntrance(
    released.model,
    released.pending.length,
    worldMs,
  )
  const spawned = modifyFields(entered, {
    phase: () =>
      modifyFields(round, {
        elapsedMs: () => clockMs,
        spawns: () => released.pending,
      }),
  })
  if (isWaveCleared(spawned, released.pending)) {
    return clearWave(spawned, wave)
  } else {
    return spawned
  }
}

const countDownBreak = (
  model: World,
  preparation: Round & { readonly _tag: 'Preparation' },
  worldMs: number,
): World =>
  BreakClock.match(preparation.clock, {
    Counting: () =>
      preparation.remainingMs > worldMs
        ? modifyFields(model, {
            phase: () =>
              modifyFields(preparation, {
                remainingMs: remainingMs => remainingMs - worldMs,
              }),
          })
        : startWaveEarly(model),
    Waiting: ({ elapsedMs }) =>
      modifyFields(model, {
        phase: () =>
          modifyFields(preparation, {
            clock: () => BreakClock.Waiting({ elapsedMs: elapsedMs + worldMs }),
          }),
      }),
  })

export const advanceRound = (model: World, worldMs: number): World =>
  Phase.match(model.phase, {
    Ready: () => model,
    Preparation: preparation => {
      if (isCoop(model)) {
        return isEveryoneReady(model)
          ? startWaveEarly(model)
          : countDownBreak(model, preparation, worldMs)
      }
      return ShopState.isAnyOf(['Browsing'])(model.shop) ||
        isPracticeGateHeld(model) ||
        isKitchenTourOn(model)
        ? model
        : countDownBreak(model, preparation, worldMs)
    },
    Wave: round => advanceWave(model, round, worldMs),
    Paused: () => model,
    Victory: () => model,
    GameOver: () => model,
  })

export const roundWave = (phase: Phase): number =>
  Phase.match(phase, {
    Ready: () => 1,
    Preparation: ({ wave }) => wave,
    Wave: ({ wave }) => wave,
    Paused: ({ round }) => round.wave,
    Victory: () => FINAL_WAVE,
    GameOver: ({ wave }) => wave,
  })

// NOTE: in co-op the run ends when everyone is down (decided row 4).
const isDefeated = (model: World): boolean =>
  isCoop(model)
    ? !Array.some(playersOf(model), ({ seat }) => isStanding(seat))
    : model.player.hp <= 0

export const endWhenDefeated = (model: World): World => {
  if (!isDefeated(model)) {
    return model
  }

  return modifyFields(model, {
    phase: () => Phase.GameOver({ wave: roundWave(model.phase) }),
  })
}

export const zombiesRemaining = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
): number => spawns.length + Array.filter(model.zombies, isWalking).length
