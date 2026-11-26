import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  CONTACT_ALLOWANCE_PX,
  PLAYER_RADIUS,
  SEPARATION_SPEED,
  ZOMBIE_ENTRY_SPEED,
  ZOMBIE_KNOCKBACK_DECAY_PER_SECOND,
} from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import { appendOrSame } from '#shared/sameList.ts'
import { darkBoxOf, darkPaceAt } from '#world/cellar/bulb.ts'
import { chillPace } from '#world/fridge/fridgeWeapons.ts'
import {
  BAIT_RULES,
  barricadedDoors,
  tollsOf,
  trapBlockers,
} from '#world/gear/traps.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { wadePaceAt } from '#world/level/leaks.ts'
import {
  type Clearance,
  type FlowField,
  flowFieldTowardAll,
  maybeNearestBait,
  playerDistancePx,
  steerToBait,
  steerToward,
} from '#world/level/pathing.ts'
import type { Box } from '#world/level/tileGrid.ts'
import { isInsideRoomAt } from '#world/level/tileQueries.ts'
import {
  type DanceFloor,
  danceFloorOf,
  danceVelocity,
  isDancing,
} from '#world/parlour/gramophone.ts'
import { focusOf, nearestOf, targetsOf } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  type Boss,
  type DoorId,
  GameEvent,
  type Player,
  type Vector,
  type Zombie,
  ZombieState,
} from '#world/schema/worldSchema.ts'
import { moveCircle } from '#world/step/collision.ts'
import {
  OUTWARD,
  ZERO_VECTOR,
  addVectors,
  clamp,
  countDown,
  decayKnockback,
  directionBetween,
  scaleVector,
} from '#world/step/geometry.ts'
import { queryAround, queryBuffer, sortAscending } from '#world/step/grid.ts'

import { isRooted, paceOf } from './bossFight.ts'
import { maybeChuckerHeading } from './chucker.ts'
import { frenzyPace, isFrenzied } from './frenzy.ts'
import { isLastZombie, lastZombieSpeed } from './lastZombie.ts'
import { MAX_BODY_RADIUS_PX, groundedColumns } from './zombieGrid.ts'
import {
  bodyRadiusOf,
  isFree,
  isGrounded,
  radiusOf,
  statsOf,
  strideAt,
} from './zombies.ts'

const isFinishedDying = (zombie: Zombie): boolean =>
  ZombieState.match(zombie.state, {
    Walking: () => false,
    Fusing: () => false,
    Dying: ({ remainingMs }) => remainingMs <= 0,
  })

const SURELY_APART = 1 + 1e-9

export const separationPushes = (
  zombies: ReadonlyArray<Zombie>,
): ReadonlyArray<Vector> => {
  const { grid, xs, ys, radii, masses, ids } = groundedColumns(zombies)
  const near = queryBuffer(grid)
  const inReach = queryBuffer(grid)
  return Array.map(zombies, (zombie, row) => {
    if (!isGrounded(zombie)) {
      return ZERO_VECTOR
    }

    const x = xs[row] ?? 0
    const y = ys[row] ?? 0
    const radius = radii[row] ?? 0
    const id = ids[row] ?? 0
    const count = queryAround(grid, near, zombie, radius + MAX_BODY_RADIUS_PX)
    let kept = 0
    for (let at = 0; at < count; at++) {
      const other = near[at] ?? 0
      const deltaX = x - (xs[other] ?? 0)
      const deltaY = y - (ys[other] ?? 0)
      const reach = radius + (radii[other] ?? 0)
      const farSquared = reach * reach * SURELY_APART
      if (
        (ids[other] ?? 0) !== id &&
        !(deltaX * deltaX + deltaY * deltaY > farSquared) &&
        !(DetMath.hypot(deltaX, deltaY) >= reach)
      ) {
        inReach[kept] = other
        kept++
      }
    }
    if (kept === 0) {
      return ZERO_VECTOR
    }

    sortAscending(inReach, kept)
    const mass = masses[row] ?? 1
    let pushX = 0
    let pushY = 0
    for (let at = 0; at < kept; at++) {
      const other = inReach[at] ?? 0
      const otherId = ids[other] ?? 0
      const deltaX = x - (xs[other] ?? 0)
      const deltaY = y - (ys[other] ?? 0)
      const reach = radius + (radii[other] ?? 0)
      const distance = DetMath.hypot(deltaX, deltaY)
      const otherMass = masses[other] ?? 1
      const share = (2 * otherMass) / (mass + otherMass)
      const strength = ((reach - distance) / reach) * share
      if (distance > 0) {
        pushX += (deltaX / distance) * strength
        pushY += (deltaY / distance) * strength
      } else {
        pushX += id < otherId ? -strength : strength
        pushY += 0
      }
    }
    return { x: pushX, y: pushY }
  })
}

type FlowFields = (clearance: Clearance) => FlowField

type Obstacles = Readonly<{
  level: Level
  blockers: ReadonlyArray<Box>
  barricaded: ReadonlyArray<DoorId>
  boss: Boss
  zombies: ReadonlyArray<Zombie>
  loneMs: number
  danceFloor: Option.Option<DanceFloor>
  dark: Option.Option<Box>
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
    flowFields(stats.clearance),
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
  zombie.kind === 'Thrower' && !isLastZombie(zombie, obstacles.loneMs)
    ? Option.getOrElse(
        maybeChuckerHeading(obstacles.level, zombie, obstacles.zombies, target),
        () => flowHeading(zombie, flowFields, target, obstacles),
      )
    : flowHeading(zombie, flowFields, target, obstacles)

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
      flowFields(statsOf(zombie).clearance),
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

const walkingSpeed = (
  zombie: Zombie,
  obstacles: Obstacles,
  pace: number,
): number => {
  const { level } = obstacles
  const own = zombie.speed * frenzyPace(zombie)
  const hurried = isLastZombie(zombie, obstacles.loneMs)
    ? lastZombieSpeed(own, obstacles.loneMs)
    : own
  const speed =
    hurried *
    pace *
    chillPace(zombie) *
    darkPaceAt(zombie, obstacles.dark) *
    wadePaceAt(level, zombie)
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
        : Option.isSome(obstacles.danceFloor) &&
            isDancing(zombie, obstacles.danceFloor.value)
          ? danceVelocity(
              zombie,
              obstacles.danceFloor.value,
              walkingSpeed(zombie, obstacles, pace),
            )
          : scaleVector(
              heading(zombie, flowFields, target, obstacles),
              walkingSpeed(zombie, obstacles, pace),
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

const decayedKnockback = (knockback: Vector, seconds: number): Vector =>
  knockback === ZERO_VECTOR
    ? ZERO_VECTOR
    : decayKnockback(knockback, ZOMBIE_KNOCKBACK_DECAY_PER_SECOND, seconds)

const advanceZombie = (
  zombie: Zombie,
  separation: Vector,
  flowFields: FlowFields,
  obstacles: Obstacles,
  target: Vector,
  seconds: number,
  deltaMs: number,
): Zombie => {
  const steering = steeringVelocity(
    zombie,
    flowFields,
    target,
    obstacles,
    isRooted(obstacles.boss, zombie),
    paceOf(obstacles.boss, zombie, target),
  )
  const { knockback } = zombie
  const step = {
    x: (steering.x + knockback.x + separation.x * SEPARATION_SPEED) * seconds,
    y: (steering.y + knockback.y + separation.y * SEPARATION_SPEED) * seconds,
  }
  const moved = holdOffPlayer(
    zombie,
    moveCircle(
      obstacles.level,
      zombie,
      step,
      radiusOf(zombie),
      obstacles.blockers,
    ),
    target,
    obstacles,
  )
  const nextKnockback = decayedKnockback(knockback, seconds)
  const hitRemainingMs = countDown(zombie.hitRemainingMs, deltaMs)
  const state = tickZombieState(zombie.state, deltaMs)
  return Object.is(moved.x, zombie.x) &&
    Object.is(moved.y, zombie.y) &&
    nextKnockback === knockback &&
    Object.is(hitRemainingMs, zombie.hitRemainingMs) &&
    state === zombie.state
    ? zombie
    : {
        ...zombie,
        x: moved.x,
        y: moved.y,
        knockback: nextKnockback,
        hitRemainingMs,
        state,
      }
}

export const advanceZombies: {
  (seconds: number, deltaMs: number): (model: World) => ReadonlyArray<Zombie>
  (model: World, seconds: number, deltaMs: number): ReadonlyArray<Zombie>
} = Function.dual(
  3,
  (model: World, seconds: number, deltaMs: number): ReadonlyArray<Zombie> => {
    const level = levelOf(model)
    const separations = separationPushes(model.zombies)
    const obstacles: Obstacles = {
      level,
      blockers: trapBlockers(level, model.traps),
      barricaded: barricadedDoors(model.traps),
      boss: model.boss,
      zombies: model.zombies,
      loneMs: model.pacing.loneMs,
      danceFloor: danceFloorOf(model),
      dark: darkBoxOf(model),
    }
    const targets = targetsOf(model)
    const tolls = tollsOf(level, model.traps)
    const laidOut: Partial<Record<Clearance, FlowField>> = {}
    const flowFields: FlowFields = clearance =>
      (laidOut[clearance] ??= flowFieldTowardAll(
        level,
        targets,
        clearance,
        tolls,
      ))
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
  },
)

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

      const distance = DetMath.hypot(zombie.x - player.x, zombie.y - player.y)
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

export const recordFootfalls: {
  (deltaMs: number): (model: World) => World
  (model: World, deltaMs: number): World
} = Function.dual(2, (model: World, deltaMs: number): World =>
  UiStruct.evolve(model, {
    frameEvents: frameEvents =>
      appendOrSame(
        frameEvents,
        Array.getSomes(
          Array.map(
            model.zombies,
            maybeFootfall(
              focusOf(model).player,
              model.elapsedMs - deltaMs,
              model.elapsedMs,
            ),
          ),
        ),
      ),
  }),
)
