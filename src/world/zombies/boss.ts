import { Array, Function, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  MS_PER_SECOND,
  PLAYER_RADIUS,
  TILE_SIZE,
  ZOMBIE_ALIVE_MAX,
} from '../../shared/constants'
import { type Seeded, nextRandom } from '../../shared/prng'
import { trapBlockers } from '../gear/traps'
import {
  doorSpawnPoint,
  hasClearPath,
  isSolidAt,
  levelOf,
} from '../level/arena'
import { atSeat, seatStateAt } from '../party/party'
import {
  bossAttackPace,
  bossHealthScale,
  difficultySpeedScale,
} from '../run/difficulty'
import type { World } from '../schema/world'
import {
  Boss,
  type BossAttack,
  BossMove,
  type Difficulty,
  type DoorId,
  GameEvent,
  Glob,
  Invulnerability,
  type PlannedSpawn,
  type PlantedAttack,
  type PlayerSlot,
  type Vector,
  type Zombie,
} from '../schema/worldSchema'
import { moveCircle } from '../step/collision'
import { woundPlayer } from '../step/combat'
import {
  OUTWARD,
  circlesOverlap,
  directionBetween,
  distanceBetween,
  scaleVector,
} from '../step/geometry'
import { warningPoint } from '../waves/pacing'
import {
  ZOMBIE_KINDS,
  arrivingZombie,
  bodyRadiusOf,
  isGrounded,
  isWalking,
  radiusOf,
  scaledHp,
  statsOf,
} from './zombies'

// RULES

type BossRules = {
  everyWaves: number
  arriveAfterShare: number
  entranceMs: number
  firstAttackMs: number
  stompTriggerPx: number
  stompRadius: number
  stompDamage: number
  stompKnockback: number
  farPx: number
  farPace: number
  chargeLaneHalfWidth: number
  chargeSpeed: number
  chargeOvershootPx: number
  chargeDamage: number
  chargeKnockbackScale: number
  chargeShove: number
  dazedMs: number
  dazedWoundScale: number
  spitFlightMs: number
  spitRadius: number
  spitDamage: number
  puddleMs: number
  puddleRadius: number
  puddleSlow: number
  globMax: number
  belchCount: number
  belchReachPx: number
  belchSpreadPx: number
  belchEveryMs: number
  firstBelchMs: number
  belchFarRate: number
  enrageShare: number
  enrageSpeedScale: number
  enrageGapScale: number
  retryMs: number
  holdMs: number
  windUpMs: Readonly<Record<BossAttack, number>>
  recoverMs: Readonly<Record<BossAttack, number>>
  cooldownMs: Readonly<Record<BossAttack, number>>
}

export const BOSS_RULES: BossRules = {
  everyWaves: 10,
  arriveAfterShare: 2 / 3,
  entranceMs: 2600,
  firstAttackMs: 2500,
  stompTriggerPx: 44,
  stompRadius: 34,
  stompDamage: 1,
  stompKnockback: 160,
  farPx: 70,
  farPace: 1.6,
  chargeLaneHalfWidth: 8,
  chargeSpeed: 190,
  chargeOvershootPx: 60,
  chargeDamage: 2,
  chargeKnockbackScale: 1.6,
  chargeShove: 260,
  dazedMs: 1800,
  dazedWoundScale: 2,
  spitFlightMs: 900,
  spitRadius: 10,
  spitDamage: 1,
  puddleMs: 4500,
  puddleRadius: 10,
  puddleSlow: 0.5,
  globMax: 5,
  belchCount: 1,
  belchReachPx: 14,
  belchSpreadPx: 7,
  belchEveryMs: 15000,
  firstBelchMs: 6000,
  belchFarRate: 1.5,
  enrageShare: 1 / 3,
  enrageSpeedScale: 1.5,
  enrageGapScale: 0.55,
  retryMs: 400,
  holdMs: 5000,
  windUpMs: { Stomp: 1000, Belch: 800, Spit: 500, Charge: 800 },
  recoverMs: { Stomp: 600, Belch: 400, Spit: 400, Charge: 500 },
  cooldownMs: { Stomp: 1600, Belch: 1200, Spit: 4500, Charge: 3000 },
}

const BOSS_KIND = 'Boss'

export const hasBoss = (wave: number): boolean =>
  wave % BOSS_RULES.everyWaves === 0

// PLANNING

const pickDoor = (doors: ReadonlyArray<DoorId>, roll: number): DoorId =>
  Option.getOrElse(
    Array.get(doors, Math.floor(roll * doors.length)),
    () => 'North',
  )

// NOTE: the largest health scale among the wave's spawns, which carries the
// level's and co-op's crowd, so a level below ×1 (Easy, Normal) lowers him
// too. A wave with no spawns keeps him at full health.
const wavePlanHpScale = (spawns: ReadonlyArray<PlannedSpawn>): number =>
  Array.match(spawns, {
    onEmpty: () => 1,
    onNonEmpty: ([first, ...rest]) =>
      Array.reduce(rest, first.hpScale, (largest, { hpScale }) =>
        Math.max(largest, hpScale),
      ),
  })

// His health: the wave's scale times the level's own boss scale.
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

// ENTRANCE

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

const announce = (model: World, door: DoorId, hp: number): World => {
  const { x, y } = warningPoint(levelOf(model), door)
  return modifyFields(model, {
    boss: () =>
      Boss.Arriving({
        door,
        hp,
        remainingMs: BOSS_RULES.entranceMs,
        durationMs: BOSS_RULES.entranceMs,
      }),
    frameEvents: Array.append(GameEvent.BossRoared({ x, y, door })),
  })
}

export const freshFight: {
  (move: BossMove): (id: number) => Boss
  (id: number, move: BossMove): Boss
} = Function.dual(2, (id: number, move: BossMove): Boss =>
  Boss.Fighting({
    id,
    move,
    standingMs: 0,
    mood: 'Calm',
    nextFar: 'Charge',
    belchMs: BOSS_RULES.firstBelchMs,
    globs: [],
  }),
)

// NOTE: he walks in through a spawn door from outside; the front door
// stays shut to walkers, so at the finale he steps in just inside it.
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

const enter = (model: World, door: DoorId, hp: number): World => {
  const speedDraw = nextRandom(model.rngState)
  const boss = arrivingZombie({
    id: model.nextEntityId,
    kind: BOSS_KIND,
    at: entryPoint(model, door),
    speedRoll: speedDraw.value,
    speedScale: difficultySpeedScale(model.difficulty.chosen),
    hp,
  })
  return modifyFields(model, {
    zombies: Array.append(boss),
    nextEntityId: id => id + 1,
    rngState: () => speedDraw.nextState,
    boss: () =>
      freshFight(
        boss.id,
        BossMove.Stalking({ cooldownMs: BOSS_RULES.firstAttackMs }),
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
      Waiting: ({ door, waitBelow, hp }) =>
        pendingSpawns <= waitBelow ? announce(model, door, hp) : model,
      Arriving: ({ door, hp, remainingMs, durationMs }) =>
        remainingMs > worldMs
          ? modifyFields(model, {
              boss: () =>
                Boss.Arriving({
                  door,
                  hp,
                  remainingMs: remainingMs - worldMs,
                  durationMs,
                }),
            })
          : enter(model, door, hp),
      Fighting: fight =>
        Option.isSome(Option.filter(findBoss(model, fight.id), isStanding))
          ? modifyFields(model, {
              boss: () =>
                modifyFields(fight, {
                  standingMs: standingMs => standingMs + worldMs,
                }),
            })
          : modifyFields(model, { boss: () => Boss.Absent() }),
    }),
)

export const isWaveHeldByBoss = (boss: Boss): boolean =>
  Boss.match(boss, {
    Absent: () => false,
    Waiting: () => false,
    Arriving: () => true,
    Fighting: ({ standingMs }) => standingMs < BOSS_RULES.holdMs,
  })

// FIGHT

type Fight = typeof Boss.Fighting.Type

const modifyFight = (model: World, change: (fight: Fight) => Fight): World =>
  modifyFields(model, {
    boss: boss => (Boss.isAnyOf(['Fighting'])(boss) ? change(boss) : boss),
  })

const setMove = (model: World, move: BossMove): World =>
  modifyFight(model, fight => modifyFields(fight, { move: () => move }))

const emit =
  (event: GameEvent) =>
  (model: World): World =>
    modifyFields(model, { frameEvents: Array.append(event) })

export const isEnraged = (boss: Boss): boolean =>
  Boss.isAnyOf(['Fighting'])(boss) && boss.mood === 'Enraged'

// NOTE: the gap between attacks, never a tell's wind-up: rage and the
// difficulty's pace both shorten how long he rests, so a faster boss gives
// the same warning for each attack and less time between them.
const gapScale = (model: World, fight: Fight): number =>
  (fight.mood === 'Enraged' ? BOSS_RULES.enrageGapScale : 1) *
  bossAttackPace(model.difficulty.chosen)

export const isRooted: {
  (zombie: Zombie): (boss: Boss) => boolean
  (boss: Boss, zombie: Zombie): boolean
} = Function.dual(
  2,
  (boss: Boss, zombie: Zombie): boolean =>
    Boss.isAnyOf(['Fighting'])(boss) &&
    boss.id === zombie.id &&
    !BossMove.isAnyOf(['Stalking'])(boss.move),
)

export const woundScaleOf: {
  (zombie: Zombie): (boss: Boss) => number
  (boss: Boss, zombie: Zombie): number
} = Function.dual(2, (boss: Boss, zombie: Zombie): number =>
  Boss.isAnyOf(['Fighting'])(boss) &&
  boss.id === zombie.id &&
  BossMove.isAnyOf(['Dazed'])(boss.move)
    ? BOSS_RULES.dazedWoundScale
    : 1,
)

export const paceOf: {
  (zombie: Zombie, player: Vector): (boss: Boss) => number
  (boss: Boss, zombie: Zombie, player: Vector): number
} = Function.dual(3, (boss: Boss, zombie: Zombie, player: Vector): number => {
  if (!Boss.isAnyOf(['Fighting'])(boss) || boss.id !== zombie.id) {
    return 1
  }

  const rage = boss.mood === 'Enraged' ? BOSS_RULES.enrageSpeedScale : 1
  const chase =
    Math.hypot(player.x - zombie.x, player.y - zombie.y) > BOSS_RULES.farPx
      ? BOSS_RULES.farPace
      : 1
  return rage * chase
})

const awayFrom = (from: Vector, to: Vector): Vector =>
  Option.getOrElse(directionBetween(from, to), () => OUTWARD)

const isVulnerable = (model: World, slot: PlayerSlot): boolean =>
  Invulnerability.isAnyOf(['Vulnerable'])(
    seatStateAt(model, slot).player.invulnerability,
  )

const hurtPlayer = (
  model: World,
  slot: PlayerSlot,
  damage: number,
  direction: Vector,
  knockbackScale: number,
): World => {
  const { player } = seatStateAt(model, slot)
  const wounded = woundPlayer(player, damage, direction)
  return modifyFields(model, {
    seats: atSeat(slot, {
      player: () =>
        modifyFields(wounded, {
          knockback: knockback => scaleVector(knockback, knockbackScale),
        }),
    }),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({
        x: player.x,
        y: player.y,
        direction,
        source: 'Boss',
      }),
    ),
  })
}

// MOOD

const enrage = (model: World, fight: Fight, boss: Zombie): World =>
  fight.mood === 'Calm' && boss.hp <= boss.maxHp * BOSS_RULES.enrageShare
    ? pipe(
        modifyFight(model, current =>
          modifyFields(current, { mood: () => 'Enraged' }),
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
    modifyFields(current, {
      belchMs: belchMs => Math.max(0, belchMs - deltaMs * rate),
    }),
  )
}

// GLOBS

const isFlying = Glob.isAnyOf(['Flying'])

const isGlobInFlight = (fight: Fight): boolean =>
  Array.some(fight.globs, isFlying)

const tickGlob =
  (deltaMs: number) =>
  (glob: Glob): Option.Option<Glob> =>
    Glob.match(glob, {
      Flying: ({ from, to, remainingMs, durationMs }) =>
        Option.some(
          remainingMs > deltaMs
            ? Glob.Flying({
                from,
                to,
                remainingMs: remainingMs - deltaMs,
                durationMs,
              })
            : Glob.Pooled({
                at: to,
                remainingMs: BOSS_RULES.puddleMs,
                durationMs: BOSS_RULES.puddleMs,
              }),
        ),
      Pooled: ({ at, remainingMs, durationMs }) =>
        remainingMs > deltaMs
          ? Option.some(
              Glob.Pooled({
                at,
                remainingMs: remainingMs - deltaMs,
                durationMs,
              }),
            )
          : Option.none(),
    })

const isLanding =
  (deltaMs: number) =>
  (glob: Glob): boolean =>
    isFlying(glob) && glob.remainingMs <= deltaMs

const landGlob = (model: World, slot: PlayerSlot, at: Vector): World => {
  const splashed = emit(
    GameEvent.GlobLanded({ x: at.x, y: at.y, radius: BOSS_RULES.spitRadius }),
  )(model)
  return isVulnerable(splashed, slot) &&
    distanceBetween(at, seatStateAt(splashed, slot).player) <=
      BOSS_RULES.spitRadius + PLAYER_RADIUS
    ? hurtPlayer(
        splashed,
        slot,
        BOSS_RULES.spitDamage,
        awayFrom(at, seatStateAt(splashed, slot).player),
        1,
      )
    : splashed
}

const advanceGlobs = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  deltaMs: number,
): World => {
  const landed = pipe(
    fight.globs,
    Array.filter(isLanding(deltaMs)),
    Array.filterMap(glob =>
      isFlying(glob) ? Result.succeed(glob.to) : Result.failVoid,
    ),
  )
  return Array.reduce(
    landed,
    modifyFight(model, current =>
      modifyFields(current, {
        globs: globs =>
          pipe(
            globs,
            Array.filterMap(glob =>
              Result.fromOption(tickGlob(deltaMs)(glob), () => undefined),
            ),
            Array.takeRight(BOSS_RULES.globMax),
          ),
      }),
    ),
    (current, at) => landGlob(current, slot, at),
  )
}

export const puddleSlowAt: {
  (at: Vector): (boss: Boss) => number
  (boss: Boss, at: Vector): number
} = Function.dual(2, (boss: Boss, at: Vector): number =>
  Boss.isAnyOf(['Fighting'])(boss) &&
  Array.some(
    boss.globs,
    glob =>
      Glob.isAnyOf(['Pooled'])(glob) &&
      distanceBetween(glob.at, at) <= BOSS_RULES.puddleRadius,
  )
    ? BOSS_RULES.puddleSlow
    : 1,
)

// CHOOSING

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

// NOTE: a glob in the air is still a telegraph on the floor, so he waits for
// it to land before he winds up anything else. That keeps one tell at a time.
const chooseAttack = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World => {
  const distance = distanceBetween(boss, seatStateAt(model, slot).player)
  if (isGlobInFlight(fight)) {
    return setMove(model, BossMove.Stalking({ cooldownMs: BOSS_RULES.retryMs }))
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

// STOMP

const shoveFrom =
  (boss: Zombie) =>
  (zombie: Zombie): Zombie =>
    zombie.id !== boss.id &&
    isGrounded(zombie) &&
    circlesOverlap(boss, BOSS_RULES.stompRadius, zombie, bodyRadiusOf(zombie))
      ? modifyFields(zombie, {
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
      modifyFields(model, {
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

// BELCH

const belchPoint = (
  model: World,
  boss: Zombie,
  toward: Vector,
  index: number,
): Vector => {
  const across = { x: -toward.y, y: toward.x }
  const side = index - (BOSS_RULES.belchCount - 1) / 2
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

// NOTE: his Groaners take the wave's scale, read back off his health, but
// not the level's boss scale, which is his alone.
const belchedHp = (boss: Zombie, difficulty: Difficulty): number =>
  scaledHp(
    ZOMBIE_KINDS.Shambler.hp,
    boss.maxHp / (ZOMBIE_KINDS.Boss.hp * bossHealthScale(difficulty)),
  )

const belchOne =
  (boss: Zombie, toward: Vector) =>
  (model: World, index: number): World => {
    const speedDraw = nextRandom(model.rngState)
    return modifyFields(model, {
      zombies: Array.append(
        arrivingZombie({
          id: model.nextEntityId,
          kind: 'Shambler',
          at: belchPoint(model, boss, toward, index),
          speedRoll: speedDraw.value,
          speedScale: difficultySpeedScale(model.difficulty.chosen),
          hp: belchedHp(boss, model.difficulty.chosen),
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
  const count = Math.min(BOSS_RULES.belchCount, room)
  return recover(
    modifyFight(
      pipe(
        Array.take(Array.range(0, BOSS_RULES.belchCount - 1), count),
        Array.reduce(
          emit(
            GameEvent.BossBelched({
              x: boss.x + toward.x * BOSS_RULES.belchReachPx,
              y: boss.y + toward.y * BOSS_RULES.belchReachPx,
            }),
          )(model),
          belchOne(boss, toward),
        ),
      ),
      current =>
        modifyFields(current, {
          belchMs: () =>
            BOSS_RULES.belchEveryMs * bossAttackPace(model.difficulty.chosen),
        }),
    ),
    fight,
    'Belch',
  )
}

// SPIT

const spit = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
): World =>
  recover(
    pipe(
      modifyFight(model, current =>
        modifyFields(current, {
          nextFar: () => 'Charge',
          globs: Array.append(
            Glob.Flying({
              from: { x: boss.x, y: boss.y },
              to: {
                x: seatStateAt(model, slot).player.x,
                y: seatStateAt(model, slot).player.y,
              },
              remainingMs: BOSS_RULES.spitFlightMs,
              durationMs: BOSS_RULES.spitFlightMs,
            }),
          ),
        }),
      ),
      emit(GameEvent.BossSpat({ x: boss.x, y: boss.y })),
    ),
    fight,
    'Spit',
  )

// CHARGE

const rush = (model: World, boss: Zombie, target: Vector): World => {
  const direction = awayFrom(boss, target)
  return pipe(
    modifyFight(model, current =>
      modifyFields(current, {
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
      ? modifyFields(zombie, {
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
  const rushed = modifyFields(boss, { x: () => moved.x, y: () => moved.y })
  const swept = ram(
    modifyFields(model, {
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

// MOVES

const unleash = (
  model: World,
  slot: PlayerSlot,
  fight: Fight,
  boss: Zombie,
  attack: PlantedAttack,
): World => {
  if (attack === 'Stomp') {
    return stomp(model, slot, fight, boss)
  } else if (attack === 'Belch') {
    return belch(model, slot, fight, boss)
  } else {
    return spit(model, slot, fight, boss)
  }
}

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

// BAR

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
