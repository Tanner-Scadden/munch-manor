import { Array, Function, Option, Order, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  DOOR_HALF_WIDTH_PX,
  KITCHEN_FIRST_WAVE,
  OPEN_BREAK_WAVE,
  PACK_WARNING_MS,
  ZOMBIE_ALIVE_MAX,
} from '#shared/constants.ts'
import { type Seeded, nextRandom } from '#shared/prng.ts'
import {
  hungrierSpawns,
  isCrewOut,
  summonAtFrontDoor,
} from '#world/dare/finale.ts'
import { readyPointsFor } from '#world/heroes/rank.ts'
import { KEY_RULES, grantKeys } from '#world/keys/keys.ts'
import { levelOf } from '#world/level/arena.ts'
import { doorSpawnPoint } from '#world/level/tileQueries.ts'
import {
  focusOf,
  isCoop,
  isStanding,
  playerCountOf,
  playersOf,
  targetsOf,
} from '#world/party/party.ts'
import { isEveryoneReady, returnFallen } from '#world/party/revive.ts'
import {
  activeModifiersOf,
  chunkHealthScaleOf,
  markSpawns,
} from '#world/run/dareLadder.ts'
import {
  breakClockMsOf,
  breakMsOf,
  crowdSpawns,
  paceHolds,
  paceSpawns,
  toughenSpawns,
} from '#world/run/difficulty.ts'
import {
  isPracticeGateHeld,
  isTimedBreak,
  learnOpenBreak,
  learnTimedBreaks,
} from '#world/run/lessons.ts'
import { isKitchenTourOn } from '#world/run/tutorialRules.ts'
import { type World, modifyWorldFields } from '#world/schema/world.ts'
import {
  Alarm,
  Beat,
  Boss,
  BreakClock,
  type DoorId,
  GameEvent,
  Phase,
  type PlannedSpawn,
  type Round,
  RunMode,
  type Vector,
  ZombieAction,
  evolveRoundSpawns,
} from '#world/schema/worldSchema.ts'
import { clamp } from '#world/step/geometry.ts'
import {
  advanceBossEntrance,
  isBossOutside,
  isWaveHeldByBoss,
  planBoss,
} from '#world/zombies/boss.ts'
import { CHUCKER_RULES } from '#world/zombies/chucker.ts'
import { burrowed, drawSurfacingSpot } from '#world/zombies/crawler.ts'
import { frenzyOnArrival, frenzyPacksOf } from '#world/zombies/frenzy.ts'
import {
  ZOMBIE_KINDS,
  arrivingZombie,
  isBoss,
  isFloorKind,
  isWalking,
  scaledHp,
} from '#world/zombies/zombies.ts'

import { routeSpawns } from './doorRoute.ts'
import { nearDoorsOf } from './doorWeights.ts'
import { rollWave } from './endlessWaves.ts'
import {
  aliveCount,
  delayCampedPacks,
  delayWaitingPacks,
  isAlive,
  isPackWarned,
  isThroughDoor,
  keepWarnedOnTime,
  packsWaitingToWarn,
  quietAlarm,
  stepBeat,
  waitingCount,
  warnPacks,
} from './pacing.ts'
import { GROUP_ID_STRIDE, PACK_ID_STRIDE, bySpawnTime } from './wavePacks.ts'
import { FINAL_WAVE, planFor } from './wavePlans.ts'

export const JOIN_LEAD_MS = PACK_WARNING_MS + 1500

type DoorMove = Readonly<{ pack: number; door: DoorId }>

const groupOfPack = (pack: number): number => Math.floor(pack / GROUP_ID_STRIDE)

const volleyOfPack = (pack: number): number => Math.floor(pack / PACK_ID_STRIDE)

const canPackMove = (wave: number, pack: number): boolean =>
  wave > FINAL_WAVE ||
  Option.exists(
    Array.get(planFor(wave).groups, groupOfPack(pack)),
    ({ isAnyDoor }) => isAnyDoor,
  )

const mateDoorsOf = (
  spawns: ReadonlyArray<PlannedSpawn>,
  moved: ReadonlyMap<number, DoorId>,
  pack: number,
): ReadonlyArray<DoorId> =>
  pipe(
    spawns,
    Array.filter(
      spawn =>
        spawn.pack !== pack && volleyOfPack(spawn.pack) === volleyOfPack(pack),
    ),
    Array.map(spawn => moved.get(spawn.pack) ?? spawn.door),
  )

const pickDoor = (
  doors: Array.NonEmptyReadonlyArray<DoorId>,
  mask: number,
  draw: number,
): DoorId => {
  const choices: Array<DoorId> = []
  let bit = 1
  for (const door of doors) {
    if ((mask & bit) !== 0) {
      choices.push(door)
    }
    bit <<= 1
  }
  return Option.getOrElse(
    Option.orElse(Array.get(choices, Math.floor(draw * choices.length)), () =>
      Array.head(choices),
    ),
    () => Array.headNonEmpty(doors),
  )
}

const drawMoves = (
  state: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  packs: ReadonlyArray<PlannedSpawn>,
  newDoors: Array.NonEmptyReadonlyArray<DoorId>,
  share: number,
): Seeded<ReadonlyArray<DoorMove>> => {
  const bitsOf = new Map<DoorId, number>()
  Array.forEach(newDoors, (door, index) => {
    bitsOf.set(door, (bitsOf.get(door) ?? 0) | (1 << index))
  })
  const everyDoor = (1 << newDoors.length) - 1
  const moves: Array<DoorMove> = []
  const moved = new Map<number, DoorId>()
  let drawState = state
  for (const { pack } of packs) {
    const moveDraw = nextRandom(drawState)
    drawState = moveDraw.nextState
    if (moveDraw.value < share) {
      const doorDraw = nextRandom(moveDraw.nextState)
      drawState = doorDraw.nextState
      let mates = 0
      for (const door of mateDoorsOf(spawns, moved, pack)) {
        mates |= bitsOf.get(door) ?? 0
      }
      const free = everyDoor & ~mates
      const door = pickDoor(
        newDoors,
        free === 0 ? everyDoor : free,
        doorDraw.value,
      )
      moves.push({ pack, door })
      if (!moved.has(pack)) {
        moved.set(pack, door)
      }
    }
  }
  return [drawState, moves]
}

const movedSpawns = (
  spawns: ReadonlyArray<PlannedSpawn>,
  moves: ReadonlyArray<DoorMove>,
): ReadonlyArray<PlannedSpawn> => {
  const doors = new Map<number, DoorId>()
  for (const { pack, door } of moves) {
    if (!doors.has(pack)) {
      doors.set(pack, door)
    }
  }
  return Array.map(spawns, spawn => {
    const door = doors.get(spawn.pack)
    return door === undefined
      ? spawn
      : UiStruct.evolve(spawn, { door: () => door })
  })
}

export const joinNewDoors: {
  (newDoors: ReadonlyArray<DoorId>): (model: World) => World
  (model: World, newDoors: ReadonlyArray<DoorId>): World
} = Function.dual(2, (model: World, newDoors: ReadonlyArray<DoorId>): World => {
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
        !isPackWarned(model.pacing.warnedPacks, spawn.pack) &&
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
  return UiStruct.evolve(model, {
    phase: phase =>
      evolveRoundSpawns(phase, () => movedSpawns(round.spawns, moves)),
    rngState: () => rngState,
  })
})

export { isRoundActive } from '#world/schema/worldSchema.ts'

export const isBreak = (model: World): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase)

const breakClockFor = (wave: number): BreakClock =>
  wave === OPEN_BREAK_WAVE
    ? BreakClock.Waiting({ elapsedMs: 0 })
    : BreakClock.Counting()

export const beginPreparation: {
  (
    wave: number,
    durationMs: number,
    clock?: BreakClock,
  ): (model: World) => World
  (model: World, wave: number, durationMs: number, clock?: BreakClock): World
} = Function.dual(
  (args: IArguments): boolean => typeof args[2] === 'number',
  (
    model: World,
    wave: number,
    durationMs: number,
    clock: BreakClock = breakClockFor(wave),
  ): World => {
    const [waveState, rolled] = rollWave(
      model.rngState,
      wave,
      levelOf(model).doorIds,
      nearDoorsOf(model),
    )
    const holds = paceHolds(model.difficulty.chosen, rolled.holds)
    const spawns = hungrierSpawns(
      model,
      crowdSpawns(
        playerCountOf(model),
        markSpawns(
          model.dareMark,
          toughenSpawns(
            model.difficulty.chosen,
            paceSpawns(model.difficulty.chosen, rolled.spawns),
          ),
        ),
        activeModifiersOf(model),
      ),
    )
    const [rngState, boss] = isEndless(model)
      ? planBoss(
          levelOf(model).doorIds,
          waveState,
          wave,
          spawns,
          model.difficulty.chosen,
        )
      : [waveState, Boss.Absent()]
    const markedBoss = Boss.isAnyOf(['Waiting'])(boss)
      ? UiStruct.evolve(boss, {
          hp: hp => Math.round(hp * chunkHealthScaleOf(model.dareMark)),
        })
      : boss
    return UiStruct.evolve(returnFallen(model), {
      boss: () => markedBoss,
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
        loneMs: 0,
      }),
      rngState: () => rngState,
    })
  },
)

export const isEndless = (model: World): boolean =>
  RunMode.isAnyOf(['Endless'])(model.mode)

export const pause = <M extends World>(model: M): M =>
  modifyWorldFields(model, {
    phase: phase =>
      Phase.match(phase, {
        Ready: () => phase,
        Arriving: () => phase,
        Preparation: preparation => Phase.Paused({ round: preparation }),
        Wave: wave => Phase.Paused({ round: wave }),
        Paused: () => phase,
        Escaped: () => phase,
        LeftEarly: () => phase,
        GameOver: () => phase,
      }),
  })

const learnFromBreak = (model: World, wave: number, clock: BreakClock) =>
  BreakClock.match(clock, {
    Waiting: () =>
      wave === KITCHEN_FIRST_WAVE
        ? learnTimedBreaks(learnOpenBreak(model))
        : learnOpenBreak(model),
    Counting: () =>
      isTimedBreak(wave, clock) ? learnTimedBreaks(model) : model,
  })

const payReadyEarly = (
  model: World,
  clock: BreakClock,
  remainingMs: number,
): World => {
  const points =
    BreakClock.isAnyOf(['Counting'])(clock) && !isKitchenTourOn(model)
      ? readyPointsFor(remainingMs)
      : 0
  if (points <= 0) {
    return model
  }
  const { x, y } = focusOf(model).player
  return UiStruct.evolve(model, {
    stats: stats =>
      UiStruct.evolve(stats, { readyPoints: earned => earned + points }),
    frameEvents: Array.append(GameEvent.RushedIn({ x, y, points })),
  })
}

export const startWaveEarly = (model: World): World =>
  Phase.match(model.phase, {
    Ready: () => model,
    Arriving: () => model,
    Preparation: ({ wave, spawns, clock, remainingMs }) =>
      summonAtFrontDoor(
        UiStruct.evolve(
          payReadyEarly(learnFromBreak(model, wave, clock), clock, remainingMs),
          { phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns }) },
        ),
        spawns,
      ),
    Wave: () => model,
    Paused: () => model,
    Escaped: () => model,
    LeftEarly: () => model,
    GameOver: () => model,
  })

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
      focusOf(model).player,
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
  return UiStruct.evolve(model, {
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

const keyForClear = (model: World): World => {
  const at = { x: focusOf(model).player.x, y: focusOf(model).player.y }
  return grantKeys(
    UiStruct.evolve(model, {
      frameEvents: Array.append(
        GameEvent.WaveCleared({ ...at, keys: KEY_RULES.perWaveCleared }),
      ),
    }),
    KEY_RULES.perWaveCleared,
    at,
  )
}

const clearWave = (model: World, wave: number): World =>
  Option.match(breakClockMsOf(model), {
    onNone: () =>
      beginPreparation(
        keyForClear(model),
        wave + 1,
        breakMsOf(model.difficulty.chosen),
        BreakClock.Waiting({ elapsedMs: 0 }),
      ),
    onSome: breakMs => beginPreparation(keyForClear(model), wave + 1, breakMs),
  })

const releaseDue = (
  model: World,
  spawns: ReadonlyArray<PlannedSpawn>,
  routed: ReadonlyArray<PlannedSpawn>,
  clockMs: number,
): Readonly<{ model: World; pending: ReadonlyArray<PlannedSpawn> }> => {
  if (!Array.some(spawns, spawn => spawn.atMs <= clockMs)) {
    return { model, pending: spawns }
  }
  const due = Array.filter(
    Array.zip(spawns, routed),
    ([spawn]) => spawn.atMs <= clockMs,
  )

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
    UiStruct.evolve(model, {
      pacing: () =>
        UiStruct.evolve(paced.pacing, {
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
  const spawned = UiStruct.evolve(entered, {
    phase: () =>
      UiStruct.evolve(round, {
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
        ? UiStruct.evolve(model, {
            phase: () =>
              UiStruct.evolve(preparation, {
                remainingMs: remainingMs => remainingMs - worldMs,
              }),
          })
        : startWaveEarly(model),
    Waiting: ({ elapsedMs }) =>
      UiStruct.evolve(model, {
        phase: () =>
          UiStruct.evolve(preparation, {
            clock: () => BreakClock.Waiting({ elapsedMs: elapsedMs + worldMs }),
          }),
      }),
  })

export const advanceRound: {
  (worldMs: number): (model: World) => World
  (model: World, worldMs: number): World
} = Function.dual(2, (model: World, worldMs: number): World =>
  Phase.match(model.phase, {
    Ready: () => model,
    Arriving: () => model,
    Preparation: preparation => {
      if (isCoop(model)) {
        return isEveryoneReady(model)
          ? startWaveEarly(model)
          : countDownBreak(model, preparation, worldMs)
      }
      return isPracticeGateHeld(model) || isKitchenTourOn(model)
        ? model
        : countDownBreak(model, preparation, worldMs)
    },
    Wave: round => advanceWave(model, round, worldMs),
    Paused: () => model,
    Escaped: () => model,
    LeftEarly: () => model,
    GameOver: () => model,
  }),
)

export const roundWave = (phase: Phase): number =>
  Phase.match(phase, {
    Ready: () => 1,
    Arriving: () => 1,
    Preparation: ({ wave }) => wave,
    Wave: ({ wave }) => wave,
    Paused: ({ round }) => round.wave,
    Escaped: ({ wave }) => wave,
    LeftEarly: ({ wave }) => wave,
    GameOver: ({ wave }) => wave,
  })

const isDefeated = (model: World): boolean =>
  isCoop(model)
    ? !Array.some(playersOf(model), ({ seat }) => isStanding(seat))
    : focusOf(model).player.hp <= 0

export const endWhenDefeated = (model: World): World => {
  if (isCrewOut(model)) {
    return UiStruct.evolve(model, {
      phase: () => Phase.Escaped({ wave: roundWave(model.phase) }),
    })
  }
  if (!isDefeated(model)) {
    return model
  }

  return UiStruct.evolve(model, {
    phase: () => Phase.GameOver({ wave: roundWave(model.phase) }),
  })
}

export const zombiesRemaining: {
  (spawns: ReadonlyArray<PlannedSpawn>): (model: World) => number
  (model: World, spawns: ReadonlyArray<PlannedSpawn>): number
} = Function.dual(
  2,
  (model: World, spawns: ReadonlyArray<PlannedSpawn>): number =>
    spawns.length + Array.filter(model.zombies, isWalking).length,
)
