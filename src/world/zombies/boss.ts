import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  MS_PER_SECOND,
  PLAYER_RADIUS,
  TILE_SIZE,
  ZOMBIE_ALIVE_MAX,
} from '#shared/constants.ts'
import { type Seeded, nextRandom } from '#shared/prng.ts'
import { trapBlockers } from '#world/gear/traps.ts'
import { levelOf } from '#world/level/arena.ts'
import {
  doorSpawnPoint,
  hasClearPath,
  isSolidAt,
} from '#world/level/tileQueries.ts'
import { playerCountOf, seatStateAt } from '#world/party/party.ts'
import {
  bossAttackPace,
  bossHealthScale,
  difficultySpeedScale,
} from '#world/run/difficulty.ts'
import type { World } from '#world/schema/world.ts'
import {
  Boss,
  type BossAttack,
  BossMove,
  type Difficulty,
  type DoorId,
  GameEvent,
  Glob,
  type PlannedSpawn,
  type PlantedAttack,
  type PlayerSlot,
  type Vector,
  type Zombie,
} from '#world/schema/worldSchema.ts'
import { moveCircle } from '#world/step/collision.ts'
import {
  circlesOverlap,
  distanceBetween,
  scaleVector,
} from '#world/step/geometry.ts'
import { warningPoint } from '#world/waves/pacing.ts'

import {
  type Fight,
  advanceGlobs,
  awayFrom,
  emit,
  gapScale,
  hurtPlayer,
  isEnraged,
  isGlobInFlight,
  isVulnerable,
  modifyFight,
  setMove,
} from './bossFight.ts'
import { BOSS_RULES } from './bossRules.ts'
import {
  ZOMBIE_KINDS,
  arrivingZombie,
  bodyRadiusOf,
  isGrounded,
  isWalking,
  radiusOf,
  scaledHp,
  statsOf,
} from './zombies.ts'

const BOSS_KIND = 'Boss'

export const hasBoss = (wave: number): boolean =>
  wave % BOSS_RULES.everyWaves === 0

const pickDoor = (doors: ReadonlyArray<DoorId>, roll: number): DoorId =>
  Option.getOrElse(
    Array.get(doors, Math.floor(roll * doors.length)),
    () => 'North',
  )

export const wavePlanHpScale = (spawns: ReadonlyArray<PlannedSpawn>): number =>
  Array.match(spawns, {
    onEmpty: () => 1,
    onNonEmpty: ([first, ...rest]) =>
      Array.reduce(rest, first.hpScale, (largest, { hpScale }) =>
        Math.max(largest, hpScale),
      ),
  })

export const bossHp: {
  (spawns: ReadonlyArray<PlannedSpawn>): (difficulty: Difficulty) => number
  (difficulty: Difficulty, spawns: ReadonlyArray<PlannedSpawn>): number
} = Function.dual(
  2,
  (difficulty: Difficulty, spawns: ReadonlyArray<PlannedSpawn>): number =>
    scaledHp(
      ZOMBIE_KINDS.Boss.hp,
      wavePlanHpScale(spawns) * bossHealthScale(difficulty),
    ),
)

export const planBoss: {
  (
    state: number,
    wave: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    difficulty: Difficulty,
  ): (doors: ReadonlyArray<DoorId>) => Seeded<Boss>
  (
    doors: ReadonlyArray<DoorId>,
    state: number,
    wave: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    difficulty: Difficulty,
  ): Seeded<Boss>
} = Function.dual(
  5,
  (
    doors: ReadonlyArray<DoorId>,
    state: number,
    wave: number,
    spawns: ReadonlyArray<PlannedSpawn>,
    difficulty: Difficulty,
  ): Seeded<Boss> => {
    if (!hasBoss(wave)) {
      return [state, Boss.Absent()]
    }

    const doorDraw = nextRandom(state)
    return [
      doorDraw.nextState,
      Boss.Waiting({
        door: pickDoor(doors, doorDraw.value),
        waitBelow: Math.round(
          spawns.length * (1 - BOSS_RULES.arriveAfterShare),
        ),
        hp: bossHp(difficulty, spawns),
        guestHpScale: wavePlanHpScale(spawns),
      }),
    ]
  },
)

export const maybeBossDoor = (boss: Boss): Option.Option<DoorId> =>
  Boss.match(boss, {
    Absent: () => Option.none(),
    Waiting: ({ door }) => Option.some(door),
    Arriving: ({ door }) => Option.some(door),
    Fighting: () => Option.none(),
  })

export const isBossOutside = (boss: Boss): boolean =>
  Boss.isAnyOf(['Waiting', 'Arriving'])(boss)

export const bossRattleDoors = (boss: Boss): ReadonlyArray<DoorId> =>
  Boss.isAnyOf(['Arriving'])(boss) ? [boss.door] : []

const findBoss = (model: World, id: number): Option.Option<Zombie> =>
  Array.findFirst(model.zombies, zombie => zombie.id === id)

const isStanding = (zombie: Zombie): boolean =>
  isWalking(zombie) && zombie.hp > 0

export const maybeStandingBoss = (model: World): Option.Option<Zombie> =>
  Boss.match(model.boss, {
    Absent: () => Option.none(),
    Waiting: () => Option.none(),
    Arriving: () => Option.none(),
    Fighting: ({ id }) => Option.filter(findBoss(model, id), isStanding),
  })

const announce = (
  model: World,
  { door, hp, guestHpScale }: typeof Boss.cases.Waiting.Type,
): World => {
  const { x, y } = warningPoint(levelOf(model), door)
  return UiStruct.evolve(model, {
    boss: () =>
      Boss.Arriving({
        door,
        hp,
        guestHpScale,
        remainingMs: BOSS_RULES.entranceMs,
        durationMs: BOSS_RULES.entranceMs,
      }),
    frameEvents: Array.append(GameEvent.BossRoared({ x, y, door })),
  })
}

export const freshFight: {
  (move: BossMove, guestHpScale: number): (id: number) => Boss
  (id: number, move: BossMove, guestHpScale: number): Boss
} = Function.dual(3, (id: number, move: BossMove, guestHpScale: number): Boss =>
  Boss.Fighting({
    id,
    guestHpScale,
    move,
    standingMs: 0,
    mood: 'Calm',
    nextFar: 'Charge',
    belchMs: BOSS_RULES.firstBelchMs,
    globs: [],
  }),
)

const entryPoint = (model: World, door: DoorId): Vector => {
  const level = levelOf(model)
  if (door !== 'Front') {
    return doorSpawnPoint(level, door, 0)
  }
  const { center, outward } = level.doors.Front
  const inset = TILE_SIZE / 2 + ZOMBIE_KINDS.Boss.radius + 1
  return {
    x: center.x - outward.x * inset,
    y: center.y - outward.y * inset,
  }
}

const enter = (
  model: World,
  { door, hp, guestHpScale }: typeof Boss.cases.Arriving.Type,
): World => {
  const speedDraw = nextRandom(model.rngState)
  const boss = arrivingZombie({
    id: model.nextEntityId,
    kind: BOSS_KIND,
    at: entryPoint(model, door),
    speedRoll: speedDraw.value,
    speedScale: difficultySpeedScale(model.difficulty.chosen),
    hp,
  })
  return UiStruct.evolve(model, {
    zombies: Array.append(boss),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
    boss: () =>
      freshFight(
        boss.id,
        BossMove.Stalking({ cooldownMs: BOSS_RULES.firstAttackMs }),
        guestHpScale,
      ),
  })
}

export const advanceBossEntrance: {
  (pendingSpawns: number, worldMs: number): (model: World) => World
  (model: World, pendingSpawns: number, worldMs: number): World
} = Function.dual(
  3,
  (model: World, pendingSpawns: number, worldMs: number): World =>
    Boss.match(model.boss, {
      Absent: () => model,
      Waiting: waiting =>
        pendingSpawns <= waiting.waitBelow ? announce(model, waiting) : model,
      Arriving: arriving =>
        arriving.remainingMs > worldMs
          ? UiStruct.evolve(model, {
              boss: () =>
                Boss.Arriving({
                  ...arriving,
                  remainingMs: arriving.remainingMs - worldMs,
                }),
            })
          : enter(model, arriving),
      Fighting: fight =>
        Option.isSome(Option.filter(findBoss(model, fight.id), isStanding))
          ? UiStruct.evolve(model, {
              boss: () =>
                UiStruct.evolve(fight, {
                  standingMs: standingMs => standingMs + worldMs,
                }),
            })
          : UiStruct.evolve(model, { boss: () => Boss.Absent() }),
    }),
)

export const isWaveHeldByBoss = (boss: Boss): boolean =>
  Boss.match(boss, {
    Absent: () => false,
    Waiting: () => false,
    Arriving: () => true,
    Fighting: ({ standingMs }) => standingMs < BOSS_RULES.holdMs,
  })

const crasherCount = (model: World): number =>
  Math.min(
    BOSS_RULES.crashers +
      BOSS_RULES.crashersPerExtra * Math.max(0, playerCountOf(model) - 1),
    Math.max(0, ZOMBIE_ALIVE_MAX - aliveCount(model.zombies)),
  )

const crasherKindOf = (index: number): 'Shambler' | 'Runner' =>
  index % 2 === 0 ? 'Shambler' : 'Runner'

const callCrasher =
  (fight: Fight) =>
  (model: World, index: number): World => {
    const { doorIds } = levelOf(model)
    const door = Option.getOrElse(
      Array.get(doorIds, index % Math.max(1, doorIds.length)),
      (): DoorId => 'North',
    )
    const row = Math.floor(index / Math.max(1, doorIds.length))
    const kind = crasherKindOf(index)
    const speedDraw = nextRandom(model.rngState)
    return UiStruct.evolve(model, {
      zombies: Array.append(
        arrivingZombie({
          id: model.nextEntityId,
          kind,
          at: doorSpawnPoint(
            levelOf(model),
            door,
            (row % 2 === 0 ? 1 : -1) * row * BOSS_RULES.crasherGapPx,
          ),
          speedRoll: speedDraw.value,
          speedScale: difficultySpeedScale(model.difficulty.chosen),
          hp: scaledHp(ZOMBIE_KINDS[kind].hp, fight.guestHpScale),
        }),
      ),
      nextEntityId: id => id + 1,
      rngState: () => speedDraw.nextState,
    })
  }

const callCrashers = (model: World, fight: Fight): World => {
  const count = crasherCount(model)
  return count > 0
    ? Array.reduce(Array.range(0, count - 1), model, callCrasher(fight))
    : model
}

const enrage = (model: World, fight: Fight, boss: Zombie): World =>
  fight.mood === 'Calm' && boss.hp <= boss.maxHp * BOSS_RULES.enrageShare
    ? pipe(
        callCrashers(
          modifyFight(model, current =>
            UiStruct.evolve(current, { mood: () => 'Enraged' }),
          ),
          fight,
        ),
        emit(GameEvent.BossEnraged({ x: boss.x, y: boss.y })),
      )
    : model

const tickBelch = (
  model: World,
  slot: PlayerSlot,
  boss: Zombie,
  deltaMs: number,
): World => {
  const rate =
    distanceBetween(boss, seatStateAt(model, slot).player) > BOSS_RULES.farPx
      ? BOSS_RULES.belchFarRate
      : 1
  return modifyFight(model, current =>
    UiStruct.evolve(current, {
      belchMs: belchMs => Math.max(0, belchMs - deltaMs * rate),
    }),
  )
}

const windUp = (model: World, boss: Zombie, attack: PlantedAttack): World =>
  pipe(
    setMove(
      model,
      BossMove.WindingUp({
        attack,
        remainingMs: BOSS_RULES.windUpMs[attack],
        durationMs: BOSS_RULES.windUpMs[attack],
      }),
    ),
    emit(GameEvent.BossWoundUp({ x: boss.x, y: boss.y, attack })),
  )

const brace = (model: World, slot: PlayerSlot, boss: Zombie): World =>
  pipe(
    setMove(
      model,
      BossMove.Bracing({
        target: {
          x: seatStateAt(model, slot).player.x,
          y: seatStateAt(model, slot).player.y,
        },
        remainingMs: BOSS_RULES.windUpMs.Charge,
        durationMs: BOSS_RULES.windUpMs.Charge,
      }),
    ),
    emit(GameEvent.BossWoundUp({ x: boss.x, y: boss.y, attack: 'Charge' })),
  )

const aliveCount = (zombies: ReadonlyArray<Zombie>): number =>
  Array.filter(zombies, isWalking).length

const canCharge = (model: World, slot: PlayerSlot, boss: Zombie): boolean =>
  hasClearPath(
    levelOf(model),
    boss,
    seatStateAt(model, slot).player,
    BOSS_RULES.chargeLaneHalfWidth,
  )

const chooseAttack = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World => {
  const distance = distanceBetween(boss, seatStateAt(model, slot).player)
  const isRaging = fight.mood === 'Enraged'
  if (isGlobInFlight(fight)) {
    return setMove(model, BossMove.Stalking({ cooldownMs: BOSS_RULES.retryMs }))
  } else if (isRaging && distance <= BOSS_RULES.slamTriggerPx) {
    return windUp(model, boss, 'Slam')
  } else if (distance <= BOSS_RULES.stompTriggerPx) {
    return windUp(model, boss, 'Stomp')
  } else if (
    fight.belchMs <= 0 &&
    aliveCount(model.zombies) < ZOMBIE_ALIVE_MAX
  ) {
    return windUp(model, boss, 'Belch')
  } else if (distance <= BOSS_RULES.farPx) {
    return setMove(model, BossMove.Stalking({ cooldownMs: BOSS_RULES.retryMs }))
  } else if (fight.nextFar === 'Charge' && canCharge(model, slot, boss)) {
    return brace(model, slot, boss)
  } else {
    return windUp(model, boss, 'Spit')
  }
}

const shoveFrom =
  (boss: Zombie) =>
  (zombie: Zombie): Zombie =>
    zombie.id !== boss.id &&
    isGrounded(zombie) &&
    circlesOverlap(boss, BOSS_RULES.stompRadius, zombie, bodyRadiusOf(zombie))
      ? UiStruct.evolve(zombie, {
          knockback: () =>
            scaleVector(
              awayFrom(boss, zombie),
              BOSS_RULES.stompKnockback * statsOf(zombie).knockbackScale,
            ),
        })
      : zombie

const isPlayerInStomp = (
  model: World,
  slot: PlayerSlot,
  boss: Zombie,
): boolean =>
  isVulnerable(model, slot) &&
  circlesOverlap(
    boss,
    BOSS_RULES.stompRadius,
    seatStateAt(model, slot).player,
    PLAYER_RADIUS,
  )

const stompPlayer = (model: World, slot: PlayerSlot, boss: Zombie): World =>
  isPlayerInStomp(model, slot, boss)
    ? hurtPlayer(
        model,
        slot,
        BOSS_RULES.stompDamage,
        awayFrom(boss, seatStateAt(model, slot).player),
        1,
      )
    : model

const recover = (model: World, fight: Fight, attack: BossAttack): World =>
  setMove(
    model,
    BossMove.Recovering({
      remainingMs: BOSS_RULES.recoverMs[attack],
      cooldownMs: BOSS_RULES.cooldownMs[attack] * gapScale(model, fight),
    }),
  )

const stomp = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World =>
  recover(
    stompPlayer(
      UiStruct.evolve(model, {
        zombies: Array.map(shoveFrom(boss)),
        frameEvents: Array.append(
          GameEvent.BossStomped({
            x: boss.x,
            y: boss.y,
            radius: BOSS_RULES.stompRadius,
          }),
        ),
      }),
      slot,
      boss,
    ),
    fight,
    'Stomp',
  )

const isPlayerInSlam = (
  model: World,
  slot: PlayerSlot,
  boss: Zombie,
): boolean =>
  isVulnerable(model, slot) &&
  circlesOverlap(
    boss,
    BOSS_RULES.slamRadius,
    seatStateAt(model, slot).player,
    PLAYER_RADIUS,
  )

const shoveFromSlam =
  (boss: Zombie) =>
  (zombie: Zombie): Zombie =>
    zombie.id !== boss.id &&
    isGrounded(zombie) &&
    circlesOverlap(boss, BOSS_RULES.slamRadius, zombie, bodyRadiusOf(zombie))
      ? UiStruct.evolve(zombie, {
          knockback: () =>
            scaleVector(
              awayFrom(boss, zombie),
              BOSS_RULES.slamKnockback * statsOf(zombie).knockbackScale,
            ),
        })
      : zombie

const slam = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World => {
  const landed = UiStruct.evolve(model, {
    zombies: Array.map(shoveFromSlam(boss)),
    frameEvents: Array.append(
      GameEvent.BossStomped({
        x: boss.x,
        y: boss.y,
        radius: BOSS_RULES.slamRadius,
      }),
    ),
  })
  return recover(
    isPlayerInSlam(landed, slot, boss)
      ? hurtPlayer(
          landed,
          slot,
          BOSS_RULES.slamDamage,
          awayFrom(boss, seatStateAt(landed, slot).player),
          BOSS_RULES.slamKnockback / BOSS_RULES.stompKnockback,
        )
      : landed,
    fight,
    'Slam',
  )
}

const belchCountOf = (fight: Fight): number =>
  fight.mood === 'Enraged' ? BOSS_RULES.ragedBelchCount : BOSS_RULES.belchCount

const belchPoint = (
  model: World,
  boss: Zombie,
  toward: Vector,
  index: number,
  count: number,
): Vector => {
  const across = { x: -toward.y, y: toward.x }
  const side = index - (count - 1) / 2
  const point = {
    x:
      boss.x +
      toward.x * BOSS_RULES.belchReachPx +
      across.x * side * BOSS_RULES.belchSpreadPx,
    y:
      boss.y +
      toward.y * BOSS_RULES.belchReachPx +
      across.y * side * BOSS_RULES.belchSpreadPx,
  }
  return isSolidAt(levelOf(model), point) ? { x: boss.x, y: boss.y } : point
}

const belchOne =
  (fight: Fight, boss: Zombie, toward: Vector, count: number) =>
  (model: World, index: number): World => {
    const speedDraw = nextRandom(model.rngState)
    return UiStruct.evolve(model, {
      zombies: Array.append(
        arrivingZombie({
          id: model.nextEntityId,
          kind: 'Shambler',
          at: belchPoint(model, boss, toward, index, count),
          speedRoll: speedDraw.value,
          speedScale: difficultySpeedScale(model.difficulty.chosen),
          hp: scaledHp(ZOMBIE_KINDS.Shambler.hp, fight.guestHpScale),
        }),
      ),
      nextEntityId: id => id + 1,
      rngState: () => speedDraw.nextState,
    })
  }

const belch = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World => {
  const toward = awayFrom(boss, seatStateAt(model, slot).player)
  const room = Math.max(0, ZOMBIE_ALIVE_MAX - aliveCount(model.zombies))
  const planned = belchCountOf(fight)
  const count = Math.min(planned, room)
  return recover(
    modifyFight(
      pipe(
        Array.take(Array.range(0, planned - 1), count),
        Array.reduce(
          emit(
            GameEvent.BossBelched({
              x: boss.x + toward.x * BOSS_RULES.belchReachPx,
              y: boss.y + toward.y * BOSS_RULES.belchReachPx,
            }),
          )(model),
          belchOne(fight, boss, toward, planned),
        ),
      ),
      current =>
        UiStruct.evolve(current, {
          belchMs: () =>
            BOSS_RULES.belchEveryMs *
            bossAttackPace(model.difficulty.chosen) *
            (fight.mood === 'Enraged' ? BOSS_RULES.ragedBelchScale : 1),
        }),
    ),
    fight,
    'Belch',
  )
}

const spitTargets = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): ReadonlyArray<Vector> => {
  const { player } = seatStateAt(model, slot)
  const target = { x: player.x, y: player.y }
  if (fight.mood !== 'Enraged') {
    return [target]
  }
  const toward = awayFrom(boss, target)
  const across = { x: -toward.y, y: toward.x }
  const middle = (BOSS_RULES.volleyCount - 1) / 2
  return Array.map(Array.range(0, BOSS_RULES.volleyCount - 1), index => {
    const point = {
      x: target.x + across.x * (index - middle) * BOSS_RULES.volleySpreadPx,
      y: target.y + across.y * (index - middle) * BOSS_RULES.volleySpreadPx,
    }
    return isSolidAt(levelOf(model), point) ? target : point
  })
}

const spit = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World =>
  recover(
    pipe(
      modifyFight(model, current =>
        UiStruct.evolve(current, {
          nextFar: () => 'Charge',
          globs: globs => [
            ...globs,
            ...Array.map(spitTargets(model, slot, fight, boss), to =>
              Glob.Flying({
                from: { x: boss.x, y: boss.y },
                to,
                remainingMs: BOSS_RULES.spitFlightMs,
                durationMs: BOSS_RULES.spitFlightMs,
              }),
            ),
          ],
        }),
      ),
      emit(GameEvent.BossSpat({ x: boss.x, y: boss.y })),
    ),
    fight,
    'Spit',
  )

const rush = (model: World, boss: Zombie, target: Vector): World => {
  const direction = awayFrom(boss, target)
  return pipe(
    modifyFight(model, current =>
      UiStruct.evolve(current, {
        nextFar: () => 'Spit',
        move: () =>
          BossMove.Rushing({
            direction,
            remainingPx:
              distanceBetween(boss, target) + BOSS_RULES.chargeOvershootPx,
          }),
      }),
    ),
    emit(GameEvent.BossRushed({ x: boss.x, y: boss.y, direction })),
  )
}

const sideOf = (direction: Vector, from: Vector, point: Vector): number =>
  direction.x * (point.y - from.y) - direction.y * (point.x - from.x) >= 0
    ? 1
    : -1

const sweptAside = (boss: Zombie, direction: Vector, point: Vector): Vector => {
  const side = sideOf(direction, boss, point)
  return awayFrom(
    { x: 0, y: 0 },
    {
      x: direction.x * 0.5 - direction.y * side,
      y: direction.y * 0.5 + direction.x * side,
    },
  )
}

const bowl =
  (boss: Zombie, direction: Vector) =>
  (zombie: Zombie): Zombie =>
    zombie.id !== boss.id &&
    isGrounded(zombie) &&
    circlesOverlap(boss, bodyRadiusOf(boss), zombie, bodyRadiusOf(zombie))
      ? UiStruct.evolve(zombie, {
          knockback: () =>
            scaleVector(
              sweptAside(boss, direction, zombie),
              BOSS_RULES.chargeShove * statsOf(zombie).knockbackScale,
            ),
        })
      : zombie

const ram = (
  model: World,
  slot: PlayerSlot,
  boss: Zombie,
  direction: Vector,
): World =>
  isVulnerable(model, slot) &&
  circlesOverlap(
    boss,
    bodyRadiusOf(boss),
    seatStateAt(model, slot).player,
    PLAYER_RADIUS,
  )
    ? pipe(
        hurtPlayer(
          model,
          slot,
          BOSS_RULES.chargeDamage,
          sweptAside(boss, direction, seatStateAt(model, slot).player),
          BOSS_RULES.chargeKnockbackScale,
        ),
        emit(
          GameEvent.BossRammed({
            x: seatStateAt(model, slot).player.x,
            y: seatStateAt(model, slot).player.y,
            direction,
          }),
        ),
      )
    : model

const bonk = (model: World, boss: Zombie, direction: Vector): World =>
  pipe(
    setMove(
      model,
      BossMove.Dazed({
        remainingMs: BOSS_RULES.dazedMs,
        durationMs: BOSS_RULES.dazedMs,
      }),
    ),
    emit(
      GameEvent.BossBonked({
        x: boss.x + direction.x * bodyRadiusOf(boss),
        y: boss.y + direction.y * bodyRadiusOf(boss),
        direction,
      }),
    ),
  )

const BLOCKED_SHARE = 0.5

const stepRush = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
  direction: Vector,
  remainingPx: number,
  deltaMs: number,
): World => {
  const stepPx = Math.min(
    remainingPx,
    (BOSS_RULES.chargeSpeed * deltaMs) / MS_PER_SECOND,
  )
  const moved = moveCircle(
    levelOf(model),
    boss,
    scaleVector(direction, stepPx),
    radiusOf(boss),
    trapBlockers(levelOf(model), model.traps),
  )
  const progress =
    (moved.x - boss.x) * direction.x + (moved.y - boss.y) * direction.y
  const rushed = UiStruct.evolve(boss, { x: () => moved.x, y: () => moved.y })
  const swept = ram(
    UiStruct.evolve(model, {
      zombies: Array.map(zombie =>
        zombie.id === boss.id ? rushed : bowl(rushed, direction)(zombie),
      ),
    }),
    slot,
    rushed,
    direction,
  )
  if (stepPx > 0 && progress < stepPx * BLOCKED_SHARE) {
    return bonk(swept, rushed, direction)
  } else if (remainingPx - stepPx <= 0) {
    return recover(swept, fight, 'Charge')
  } else {
    return setMove(
      swept,
      BossMove.Rushing({ direction, remainingPx: remainingPx - stepPx }),
    )
  }
}

const UNLEASHERS: Readonly<
  Record<
    PlantedAttack,
    (model: World, slot: PlayerSlot, fight: Fight, boss: Zombie) => World
  >
> = { Stomp: stomp, Slam: slam, Belch: belch, Spit: spit }

const unleash = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
  attack: PlantedAttack,
): World => UNLEASHERS[attack](model, slot, fight, boss)

const stepMove = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
  deltaMs: number,
): World =>
  BossMove.match(fight.move, {
    Stalking: ({ cooldownMs }) =>
      cooldownMs > deltaMs
        ? setMove(
            model,
            BossMove.Stalking({ cooldownMs: cooldownMs - deltaMs }),
          )
        : chooseAttack(model, slot, fight, boss),
    WindingUp: ({ attack, remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? setMove(
            model,
            BossMove.WindingUp({
              attack,
              remainingMs: remainingMs - deltaMs,
              durationMs,
            }),
          )
        : unleash(model, slot, fight, boss, attack),
    Bracing: ({ target, remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? setMove(
            model,
            BossMove.Bracing({
              target,
              remainingMs: remainingMs - deltaMs,
              durationMs,
            }),
          )
        : rush(model, boss, target),
    Rushing: ({ direction, remainingPx }) =>
      stepRush(model, slot, fight, boss, direction, remainingPx, deltaMs),
    Dazed: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? setMove(
            model,
            BossMove.Dazed({ remainingMs: remainingMs - deltaMs, durationMs }),
          )
        : setMove(
            model,
            BossMove.Stalking({
              cooldownMs: BOSS_RULES.cooldownMs.Charge * gapScale(model, fight),
            }),
          ),
    Recovering: ({ remainingMs, cooldownMs }) =>
      remainingMs > deltaMs
        ? setMove(
            model,
            BossMove.Recovering({
              remainingMs: remainingMs - deltaMs,
              cooldownMs,
            }),
          )
        : setMove(model, BossMove.Stalking({ cooldownMs })),
  })

const currentFight = (model: World): Option.Option<Fight> =>
  Boss.isAnyOf(['Fighting'])(model.boss)
    ? Option.some(model.boss)
    : Option.none()

const withFight =
  (step: (model: World, fight: Fight) => World) =>
  (model: World): World =>
    Option.match(currentFight(model), {
      onNone: () => model,
      onSome: fight => step(model, fight),
    })

export const advanceBossMoves: {
  (slot: PlayerSlot, deltaMs: number): (model: World) => World
  (model: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(3, (model: World, slot: PlayerSlot, deltaMs: number): World =>
  Option.match(maybeStandingBoss(model), {
    onNone: () =>
      withFight((current, fight) =>
        advanceGlobs(current, slot, fight, deltaMs),
      )(model),
    onSome: boss =>
      pipe(
        model,
        withFight((current, fight) =>
          advanceGlobs(current, slot, fight, deltaMs),
        ),
        withFight((current, fight) => enrage(current, fight, boss)),
        withFight(current => tickBelch(current, slot, boss, deltaMs)),
        withFight((current, fight) =>
          stepMove(current, slot, fight, boss, deltaMs),
        ),
      ),
  }),
)

export type BossBar = Readonly<{
  name: string
  hp: number
  maxHp: number
  isEnraged: boolean
}>

export const maybeBossBar = (model: World): Option.Option<BossBar> =>
  Option.map(maybeStandingBoss(model), ({ hp, maxHp }) => ({
    name: ZOMBIE_KINDS.Boss.name,
    hp,
    maxHp,
    isEnraged: isEnraged(model.boss),
  }))
