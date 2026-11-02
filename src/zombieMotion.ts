import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  type Level,
  isInsideRoomAt,
  levelOf,
  moveCircle,
} from './arena'
import { isRooted, paceOf } from './boss'
import { maybeChuckerHeading } from './chucker'
import {
  CONTACT_ALLOWANCE_PX,
  PLAYER_RADIUS,
  SEPARATION_SPEED,
  ZOMBIE_ENTRY_SPEED,
  ZOMBIE_KNOCKBACK_DECAY_PER_SECOND,
} from './constants'
import { frenzyPace, isFrenzied } from './frenzy'
import { chillPace } from './fridgeWeapons'
import {
  OUTWARD,
  ZERO_VECTOR,
  addVectors,
  clamp,
  countDown,
  decayKnockback,
  directionBetween,
  scaleVector,
} from './geometry'
import { queryAround, queryBuffer } from './grid'
import { nearestOf, targetsOf } from './party'
import {
  type Clearance,
  type FlowField,
  flowFieldsToward,
  maybeNearestBait,
  playerDistancePx,
  steerToBait,
  steerToward,
} from './pathing'
import { BAIT_RULES, barricadedDoors, tollsOf, trapBlockers } from './traps'
import type { World } from './world'
import {
  type Boss,
  type DoorId,
  GameEvent,
  type Player,
  type Vector,
  type Zombie,
  ZombieState,
} from './worldSchema'
import { MAX_BODY_RADIUS_PX, groundedGrid } from './zombieGrid'
import {
  bodyRadiusOf,
  isFree,
  isGrounded,
  radiusOf,
  statsOf,
  strideAt,
} from './zombies'

// ZOMBIES

const isFinishedDying = (zombie: Zombie): boolean =>
  ZombieState.match(zombie.state, {
    Walking: () => false,
    Fusing: () => false,
    Dying: ({ remainingMs }) => remainingMs <= 0,
  })

// SEPARATION

const pushApart = (zombie: Zombie, other: Zombie): Vector => {
  const deltaX = zombie.x - other.x
  const deltaY = zombie.y - other.y
  const distance = Math.hypot(deltaX, deltaY)
  const reach = bodyRadiusOf(zombie) + bodyRadiusOf(other)
  if (other.id === zombie.id || distance >= reach) {
    return ZERO_VECTOR
  }

  const mass = statsOf(zombie).mass
  const otherMass = statsOf(other).mass
  const share = (2 * otherMass) / (mass + otherMass)
  const strength = ((reach - distance) / reach) * share
  if (distance > 0) {
    return {
      x: (deltaX / distance) * strength,
      y: (deltaY / distance) * strength,
    }
  } else {
    return { x: zombie.id < other.id ? -strength : strength, y: 0 }
  }
}

// NOTE: each grounded zombie sums the pushes of the grounded zombies near it
// in ascending list order, the order the all-pairs loop used, so the sum is
// the same to the last bit. One out of reach of every body pushes nothing.
const separationPushes = (
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Vector> => {
  const grid = groundedGrid(zombies)
  const near = queryBuffer(grid)
  return Array.map(zombies, zombie => {
    if (!isGrounded(zombie)) {
      return ZERO_VECTOR
    }

    const count = queryAround(grid, near, zombie, 2 * MAX_BODY_RADIUS_PX)
    let pushX = 0
    let pushY = 0
    let isPushed = false
    for (let at = 0; at < count; at++) {
      const other = zombies[near[at] ?? 0]
      if (other !== undefined) {
        const push = pushApart(zombie, other)
        if (push !== ZERO_VECTOR) {
          pushX += push.x
          pushY += push.y
          isPushed = true
        }
      }
    }
    return isPushed ? { x: pushX, y: pushY } : ZERO_VECTOR
  })
}

type FlowFields = Readonly<Record<Clearance, FlowField>>

type Obstacles = Readonly<{
  level: Level
  blockers: ReadonlyArray<Box>
  barricaded: ReadonlyArray<DoorId>
  boss: Boss
  zombies: ReadonlyArray<Zombie>
}>

const flowHeading = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
): Vector => {
  const stats = statsOf(zombie)
  return steerToward(
    obstacles.level,
    flowFields[stats.clearance],
    zombie,
    target,
    stats.radius - 1,
    stats.clearance,
    obstacles.barricaded,
  )
}

const chaseHeading = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
): Vector =>
  zombie.kind === 'Thrower'
    ? Option.getOrElse(
        maybeChuckerHeading(obstacles.level, zombie, obstacles.zombies, target),
        () => flowHeading(zombie, flowFields, target, obstacles),
      )
    : flowHeading(zombie, flowFields, target, obstacles)

// NOTE: a slow zombie in the room goes for a standing Plank Pile within
// BAIT_RULES.pullPx of walking when the plank is nearer than the player. A
// frenzied one only has eyes for the player.
const maybeBaitDoor = (
  level: Level,
  zombie: Zombie,
  playerField: FlowField,
  barricaded: ReadonlyArray<DoorId>,
): Option.Option<DoorId> => {
  const stats = statsOf(zombie)
  if (
    stats.bait === 'Ignores' ||
    Array.isReadonlyArrayEmpty(barricaded) ||
    isFrenzied(zombie) ||
    !isInsideRoomAt(level, zombie)
  ) {
    return Option.none()
  }

  return pipe(
    maybeNearestBait(
      level,
      zombie,
      barricaded,
      stats.clearance,
      BAIT_RULES.pullPx,
    ),
    Option.filter(
      ({ distancePx }) =>
        distancePx < playerDistancePx(level, playerField, zombie),
    ),
    Option.map(({ door }) => door),
  )
}

const heading = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
): Vector =>
  Option.match(
    maybeBaitDoor(
      obstacles.level,
      zombie,
      flowFields[statsOf(zombie).clearance],
      obstacles.barricaded,
    ),
    {
      onSome: door =>
        steerToBait(
          obstacles.level,
          door,
          zombie,
          statsOf(zombie).radius - 1,
          statsOf(zombie).clearance,
        ),
      onNone: () => chaseHeading(zombie, flowFields, target, obstacles),
    },
  )

// NOTE: a zombie still outside the room is not drawn, so it walks at least
// ZOMBIE_ENTRY_SPEED until it reaches its doorway: it shows up a beat after
// its door's warning ends, whatever its own pace. In the room it walks at
// its own.
const walkingSpeed = (zombie: Zombie, level: Level, pace: number): number => {
  const speed = zombie.speed * pace * frenzyPace(zombie) * chillPace(zombie)
  return isInsideRoomAt(level, zombie)
    ? speed
    : Math.max(speed, ZOMBIE_ENTRY_SPEED)
}

const steeringVelocity = (
  zombie: Zombie,
  flowFields: FlowFields,
  target: Vector,
  obstacles: Obstacles,
  isHeld: boolean,
  pace: number,
): Vector =>
  ZombieState.match(zombie.state, {
    Walking: () =>
      isHeld || !isFree(zombie)
        ? ZERO_VECTOR
        : scaleVector(
            heading(zombie, flowFields, target, obstacles),
            walkingSpeed(zombie, obstacles.level, pace),
          ),
    Fusing: () => ZERO_VECTOR,
    Dying: () => ZERO_VECTOR,
  })

const tickZombieState = (state: ZombieState, deltaMs: number): ZombieState =>
  ZombieState.match(state, {
    Walking: () => state,
    Fusing: ({ remainingMs }) =>
      ZombieState.Fusing({ remainingMs: remainingMs - deltaMs }),
    Dying: ({ remainingMs, direction }) =>
      ZombieState.Dying({ remainingMs: remainingMs - deltaMs, direction }),
  })

// NOTE: a free zombie stops at the player's body, at most
// CONTACT_ALLOWANCE_PX deep, so it bites from the edge instead of standing on
// the player where a shot cannot find it. Only the zombie moves, out along
// the line from the player to where it stood before this step, so one fast
// enough to cross the player's center lands back on the side it came from.
// It moves through moveCircle, so walls and traps still hold it.
const holdOffPlayer = (
  zombie: Zombie,
  moved: Vector,
  player: Vector,
  obstacles: Obstacles,
): Vector => {
  const reach = bodyRadiusOf(zombie) + PLAYER_RADIUS - CONTACT_ALLOWANCE_PX
  const deltaX = moved.x - player.x
  const deltaY = moved.y - player.y
  if (!isFree(zombie) || deltaX * deltaX + deltaY * deltaY >= reach * reach) {
    return moved
  }

  const away = pipe(
    directionBetween(player, zombie),
    Option.orElse(() => directionBetween(player, moved)),
    Option.getOrElse(() => OUTWARD),
  )
  const edge = addVectors(player, scaleVector(away, reach))
  return moveCircle(
    obstacles.level,
    moved,
    { x: edge.x - moved.x, y: edge.y - moved.y },
    radiusOf(zombie),
    obstacles.blockers,
  )
}

const advanceZombie = (
  zombie: Zombie,
  separation: Vector,
  flowFields: FlowFields,
  obstacles: Obstacles,
  target: Vector,
  seconds: number,
  deltaMs: number,
): Zombie => {
  const velocity = addVectors(
    addVectors(
      steeringVelocity(
        zombie,
        flowFields,
        target,
        obstacles,
        isRooted(obstacles.boss, zombie),
        paceOf(obstacles.boss, zombie, target),
      ),
      zombie.knockback,
    ),
    scaleVector(separation, SEPARATION_SPEED),
  )
  const moved = holdOffPlayer(
    zombie,
    moveCircle(
      obstacles.level,
      zombie,
      scaleVector(velocity, seconds),
      radiusOf(zombie),
      obstacles.blockers,
    ),
    target,
    obstacles,
  )
  return modifyFields(zombie, {
    x: () => moved.x,
    y: () => moved.y,
    knockback: knockback =>
      decayKnockback(knockback, ZOMBIE_KNOCKBACK_DECAY_PER_SECOND, seconds),
    hitRemainingMs: remainingMs => countDown(remainingMs, deltaMs),
    state: state => tickZombieState(state, deltaMs),
  })
}

export const advanceZombies = (
  model: World,
  seconds: number,
  deltaMs: number,
): ReadonlyArray<Zombie> => {
  const level = levelOf(model)
  const separations = separationPushes(model.zombies)
  const obstacles: Obstacles = {
    level,
    blockers: trapBlockers(level, model.traps),
    barricaded: barricadedDoors(model.traps),
    boss: model.boss,
    zombies: model.zombies,
  }
  const targets = targetsOf(model)
  const flowFields = flowFieldsToward(
    level,
    targets,
    tollsOf(level, model.traps),
  )
  return pipe(
    model.zombies,
    Array.map((zombie, index) =>
      advanceZombie(
        zombie,
        Option.getOrElse(Array.get(separations, index), () => ZERO_VECTOR),
        flowFields,
        obstacles,
        nearestOf(targets, zombie),
        seconds,
        deltaMs,
      ),
    ),
    Array.filter(zombie => !isFinishedDying(zombie)),
  )
}

// FOOTFALLS

const maybeFootfall =
  (player: Player, previousMs: number, elapsedMs: number) =>
  (zombie: Zombie): Option.Option<GameEvent> =>
    Option.flatMap(statsOf(zombie).maybeFootfall, footfall => {
      const stride = strideAt(zombie, elapsedMs)
      if (
        !isFree(zombie) ||
        stride === strideAt(zombie, previousMs) ||
        stride % footfall.everyStrides !== 0
      ) {
        return Option.none()
      }

      const distance = Math.hypot(zombie.x - player.x, zombie.y - player.y)
      return Option.some(
        GameEvent.Footfall({
          x: zombie.x,
          y: zombie.y,
          kind: zombie.kind,
          nearness:
            footfall.rangePx > 0
              ? clamp(1 - distance / footfall.rangePx, 0, 1)
              : 0,
        }),
      )
    })

export const recordFootfalls = (model: World, deltaMs: number): World =>
  modifyFields(model, {
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.getSomes(
        Array.map(
          model.zombies,
          maybeFootfall(
            model.player,
            model.elapsedMs - deltaMs,
            model.elapsedMs,
          ),
        ),
      ),
    ],
  })
