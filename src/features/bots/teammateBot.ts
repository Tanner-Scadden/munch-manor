import { Array, Function, Option, Order, Result, pipe } from 'effect'

import { PLAYER_RADIUS, PLAYER_SPEED } from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import { frontDoorSillOf, isFrontDoorOpen } from '#world/dare/finale.ts'
import { PAN_RULES } from '#world/fridge/fridgeWeapons.ts'
import { KNIFE_RULES } from '#world/gear/knife.ts'
import { PICKUP_LIFETIME_MS } from '#world/gear/powerups.ts'
import {
  canReload,
  carriedMagazine,
  hasPan,
  heldGun,
  heldLoaded,
  isReloading,
} from '#world/gear/weapons.ts'
import { maxHpOf } from '#world/heroes/calling.ts'
import { backDoorStandOf } from '#world/kitchen/backDoor.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { flowFieldToward, steerToward } from '#world/level/pathing.ts'
import { boxCenter } from '#world/level/tileGrid.ts'
import {
  hasClearPath,
  hasLineOfSight,
  isInYardAt,
  isInsideRoomAt,
  isSolidAt,
} from '#world/level/tileQueries.ts'
import { isCallFresh } from '#world/party/medic.ts'
import {
  COOP_RULES,
  isDowned,
  isFriendlyFireOn,
  isStanding,
  leadSeatOf,
  playersOf,
} from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  BreakClock,
  type Intent,
  Phase,
  type Pickup,
  type PlayerSlot,
  Purchasable,
  Purchase,
  type SeatState,
  type Vector,
  type Zombie,
  idleIntent,
} from '#world/schema/worldSchema.ts'
import {
  ZERO_VECTOR,
  closestPointOnSegment,
  directionBetween,
  distanceBetween,
  normalize,
} from '#world/step/geometry.ts'
import {
  type InputsByPlayer,
  SeatAction,
  applySeatAction,
} from '#world/step/stepWorld.ts'
import { bodyRadiusOf } from '#world/zombies/zombies.ts'

import {
  chandelierShot,
  isSafeToSearch,
  isWorkingSearch,
  pantryErrand,
  searchSpot,
} from './dareSearch.ts'
import {
  CHUNK_KEEP_PX,
  type Threat,
  chunkDodge,
  escapeHeading,
} from './escape.ts'

const FIRE_RANGE_PX = 100
const ELBOW_ROOM_PX = 18
const HUNT_PX = 170
const POST_INSET_PX = 30
const POST_REACHED_PX = 10
const POST_MS = 14_000
const BACK_DOOR_STOP_PX = 3
const STRAFE_MS = 1300
const RELOAD_QUIET_PX = 90
const REVIVE_STOP_PX = PLAYER_RADIUS + COOP_RULES.reviveReachPx - 4
const READY_DELAY_MS = 4000
const THREAT_SLACK_PX = 40
const PICKUP_SEEK_PX = 110
const HEART_SEEK_PX = 170
const PICKUP_SAFE_PX = 28
const LOW_HP = 2

const FLEE_PX: Readonly<Record<Zombie['kind'], number>> = {
  Shambler: 24,
  Runner: 26,
  Tank: 34,
  Exploder: 40,
  Thrower: 26,
  Crawler: 20,
  Boss: CHUNK_KEEP_PX,
}

const OUT_OF_REACH = ['Burrowed', 'Carried', 'Flying'] as const

const isShootable = (zombie: Zombie): boolean =>
  zombie.state._tag === 'Walking' &&
  !Array.contains(OUT_OF_REACH, zombie.action._tag)

const byDistanceFrom = (at: Vector) =>
  Order.mapInput(Order.Number, (zombie: Zombie) => distanceBetween(at, zombie))

const nearestShootable = (world: World, at: Vector): Option.Option<Zombie> =>
  Array.reduce(world.zombies, Option.none<Zombie>(), (nearest, zombie) =>
    isShootable(zombie) &&
    Option.match(nearest, {
      onNone: () => true,
      onSome: held => distanceBetween(at, zombie) < distanceBetween(at, held),
    })
      ? Option.some(zombie)
      : nearest,
  )

const downedNear = (world: World, me: SeatState): Option.Option<SeatState> =>
  pipe(
    playersOf(world),
    Array.filter(
      other => other.seat.slot !== me.seat.slot && isDowned(other.seat),
    ),
    Array.sort(
      Order.combine(
        Order.mapInput(
          Order.Boolean,
          (other: SeatState) => !isCallFresh(other.seat),
        ),
        Order.mapInput(Order.Number, (other: SeatState) =>
          distanceBetween(me.player, other.player),
        ),
      ),
    ),
    Array.head,
  )

const walkToward = (world: World, from: Vector, to: Vector): Vector => {
  if (distanceBetween(from, to) < 2) {
    return ZERO_VECTOR
  }
  const level = levelOf(world)
  return hasClearPath(level, from, to, PLAYER_RADIUS)
    ? Option.getOrElse(directionBetween(from, to), () => ZERO_VECTOR)
    : steerToward(
        level,
        flowFieldToward(level, to, 'Narrow', []),
        from,
        to,
        PLAYER_RADIUS,
        'Narrow',
        [],
      )
}

const awayFrom = (from: Vector, danger: Vector): Vector =>
  Option.getOrElse(directionBetween(danger, from), () => ({ x: 1, y: 0 }))

const sideStep = (
  from: Vector,
  danger: Vector,
  slot: PlayerSlot,
  clockMs: number,
): Vector => {
  const away = awayFrom(from, danger)
  const sign = (Math.floor(clockMs / STRAFE_MS) + slot) % 2 === 0 ? 1 : -1
  return { x: -away.y * sign, y: away.x * sign }
}

const mixed = (first: Vector, second: Vector, weight: number): Vector =>
  Option.getOrElse(
    normalize({
      x: first.x + second.x * weight,
      y: first.y + second.y * weight,
    }),
    () => ZERO_VECTOR,
  )

const postsByLevel = new WeakMap<Level, ReadonlyArray<Vector>>()

const postsOf = (level: Level): ReadonlyArray<Vector> => {
  const cached = postsByLevel.get(level)
  if (cached !== undefined) {
    return cached
  }
  const inward = Array.flatMap(level.doorIds, (id): ReadonlyArray<Vector> => {
    const { tiles, box } = level.thresholds[id]
    if (!Array.isReadonlyArrayNonEmpty(tiles)) {
      return []
    }
    const outward = level.doors[id].outward
    const threshold = boxCenter(box)
    const spot = {
      x: threshold.x - outward.x * POST_INSET_PX,
      y: threshold.y - outward.y * POST_INSET_PX,
    }
    return isInsideRoomAt(level, spot) &&
      !isInYardAt(level, spot) &&
      !isSolidAt(level, spot)
      ? [spot]
      : []
  })
  const posts: ReadonlyArray<Vector> = Array.isReadonlyArrayNonEmpty(inward)
    ? inward
    : [boxCenter(level.bounds)]
  postsByLevel.set(level, posts)
  return posts
}

const postOf = (world: World, slot: PlayerSlot): Vector => {
  const posts = postsOf(levelOf(world))
  const turn = Math.floor(clockMsOf(world) / POST_MS)
  const index = (slot * 2 + turn) % posts.length
  return Option.getOrElse(Array.get(posts, index), () =>
    boxCenter(levelOf(world).bounds),
  )
}

const elbowRoom = (world: World, me: SeatState): Option.Option<Vector> =>
  pipe(
    playersOf(world),
    Array.filter(
      other =>
        other.seat.slot !== me.seat.slot &&
        isStanding(other.seat) &&
        distanceBetween(me.player, other.player) < ELBOW_ROOM_PX,
    ),
    Array.head,
    Option.map(other => awayFrom(me.player, other.player)),
  )

const withElbowRoom = (world: World, me: SeatState, move: Vector): Vector =>
  Option.match(elbowRoom(world, me), {
    onNone: () => move,
    onSome: away => mixed(move, away, 1),
  })

const toPost = (world: World, me: SeatState): Vector => {
  const post = postOf(world, me.seat.slot)
  return distanceBetween(me.player, post) <= POST_REACHED_PX
    ? ZERO_VECTOR
    : walkToward(world, me.player, post)
}

const clockMsOf = (world: World): number =>
  Phase.match(world.phase, {
    Ready: () => 0,
    Arriving: () => 0,
    Preparation: ({ clock, durationMs, remainingMs }) =>
      BreakClock.match(clock, {
        Counting: () => durationMs - remainingMs,
        Waiting: ({ elapsedMs }) => elapsedMs,
      }),
    Wave: wave => wave.elapsedMs,
    Paused: () => 0,
    Escaped: () => 0,
    LeftEarly: () => 0,
    GameOver: () => 0,
  })

const isMateInLine = (world: World, me: SeatState, target: Vector): boolean =>
  isFriendlyFireOn(world) &&
  Array.some(
    playersOf(world),
    other =>
      other.seat.slot !== me.seat.slot &&
      isStanding(other.seat) &&
      distanceBetween(
        closestPointOnSegment(other.player, me.player, target),
        other.player,
      ) <
        PLAYER_RADIUS + 3,
  )

const maybeTargetFor = (world: World, me: SeatState): Option.Option<Zombie> =>
  pipe(
    world.zombies,
    Array.filter(
      zombie =>
        isShootable(zombie) &&
        distanceBetween(me.player, zombie) <= FIRE_RANGE_PX,
    ),
    Array.sort(byDistanceFrom(me.player)),
    Array.take(3),
    Array.findFirst(
      zombie =>
        hasLineOfSight(levelOf(world), me.player, zombie) &&
        !isMateInLine(world, me, zombie),
    ),
  )

const canShoot = (me: SeatState): boolean =>
  !isReloading(me.player) && (heldLoaded(me.player) > 0 || canReload(me.player))

const fleeFrom = (me: SeatState, zombie: Zombie): Option.Option<Zombie> =>
  distanceBetween(me.player, zombie) < FLEE_PX[zombie.kind]
    ? Option.some(zombie)
    : Option.none()

const threatsNear = (world: World, me: SeatState): ReadonlyArray<Threat> =>
  Array.filterMap(world.zombies, zombie =>
    isShootable(zombie) &&
    distanceBetween(me.player, zombie) < FLEE_PX[zombie.kind] + THREAT_SLACK_PX
      ? Result.succeed({ at: zombie, radius: bodyRadiusOf(zombie) })
      : Result.failVoid,
  )

const wants = (player: SeatState, pickup: Pickup): boolean =>
  pickup.kind !== 'Heart' || player.player.hp < maxHpOf(player.player)

const maybePickupFor = (world: World, me: SeatState): Option.Option<Pickup> =>
  pipe(
    world.pickups,
    Array.filter(pickup => {
      const gap = distanceBetween(me.player, pickup)
      const seekPx =
        pickup.kind === 'Heart' && me.player.hp <= LOW_HP
          ? HEART_SEEK_PX
          : PICKUP_SEEK_PX
      return (
        gap <= seekPx &&
        wants(me, pickup) &&
        (gap / PLAYER_SPEED) * 1000 < PICKUP_LIFETIME_MS - pickup.ageMs &&
        !Array.some(
          world.zombies,
          zombie =>
            isShootable(zombie) &&
            distanceBetween(zombie, pickup) < PICKUP_SAFE_PX,
        ) &&
        !Array.some(
          playersOf(world),
          other =>
            other.seat.slot !== me.seat.slot &&
            isStanding(other.seat) &&
            wants(other, pickup) &&
            distanceBetween(other.player, pickup) < gap,
        )
      )
    }),
    Array.sort(
      Order.mapInput(Order.Number, (pickup: Pickup) =>
        distanceBetween(me.player, pickup),
      ),
    ),
    Array.head,
  )

const toPickup = (world: World, me: SeatState): Option.Option<Vector> =>
  Option.map(maybePickupFor(world, me), pickup =>
    walkToward(world, me.player, pickup),
  )

const searchMove = (world: World, me: SeatState): Option.Option<Vector> => {
  if (isWorkingSearch(world, me.player)) {
    return Option.some(ZERO_VECTOR)
  }
  const spot = searchSpot(world, me.player)
  return spot === undefined
    ? Option.none()
    : Option.some(walkToward(world, me.player, spot))
}

const fightMove = (
  world: World,
  me: SeatState,
  maybeNearest: Option.Option<Zombie>,
  maybeTarget: Option.Option<Zombie>,
): Vector => {
  const clockMs = clockMsOf(world)
  const maybeDanger = Option.flatMap(maybeNearest, zombie =>
    fleeFrom(me, zombie),
  )
  const maybeDowned = downedNear(world, me)
  const reviveStop = Option.exists(
    maybeDowned,
    downed => distanceBetween(me.player, downed.player) <= REVIVE_STOP_PX,
  )
  const dodge = chunkDodge(world, me.player)
  if (dodge !== undefined) {
    return dodge
  }
  if (Option.isSome(maybeDanger)) {
    return escapeHeading(levelOf(world), me.player, threatsNear(world, me))
  }
  if (Option.isSome(maybeDowned)) {
    return reviveStop
      ? ZERO_VECTOR
      : walkToward(world, me.player, maybeDowned.value.player)
  }
  const maybeToPickup = toPickup(world, me)
  if (Option.isSome(maybeToPickup)) {
    return maybeToPickup.value
  }
  const maybeSearch =
    Option.isNone(maybeTarget) && isSafeToSearch(world, me.player)
      ? searchMove(world, me)
      : Option.none()
  if (Option.isSome(maybeSearch)) {
    return maybeSearch.value
  }
  return withElbowRoom(
    world,
    me,
    Option.match(maybeNearest, {
      onNone: () => toPost(world, me),
      onSome: zombie => {
        const gap = distanceBetween(me.player, zombie)
        if (Option.isSome(maybeTarget)) {
          return gap < FIRE_RANGE_PX / 2
            ? mixed(
                ZERO_VECTOR,
                sideStep(me.player, zombie, me.seat.slot, clockMs),
                0.6,
              )
            : ZERO_VECTOR
        }
        return gap <= HUNT_PX && isInsideRoomAt(levelOf(world), zombie)
          ? walkToward(world, me.player, zombie)
          : toPost(world, me)
      },
    }),
  )
}

const HAND_WINDOW_MS = 250
const AIM_WANDER_RAD = 0.2
const EASE_OFF_EVERY = 4
const HASH_SCALE = 4294967296

const handRoll = (slot: PlayerSlot, zombieId: number, window: number): number =>
  (Math.imul(slot + 1, 73856093) ^
    Math.imul(zombieId + 1, 19349663) ^
    Math.imul(window + 1, 83492791)) >>>
  0

const wanderedAim = (
  aim: Vector,
  slot: PlayerSlot,
  zombieId: number,
  window: number,
): Vector => {
  const turn =
    (handRoll(slot, zombieId, window) / HASH_SCALE - 0.5) * 2 * AIM_WANDER_RAD
  return {
    x: aim.x * DetMath.cos(turn) - aim.y * DetMath.sin(turn),
    y: aim.x * DetMath.sin(turn) + aim.y * DetMath.cos(turn),
  }
}

const fightIntent = (world: World, me: SeatState): Intent => {
  const maybeNearest = nearestShootable(world, me.player)
  const maybeTarget = maybeTargetFor(world, me)
  const window = Math.floor(clockMsOf(world) / HAND_WINDOW_MS)
  const maybeDrop = canShoot(me)
    ? Option.flatMap(chandelierShot(world, me.player), point =>
        directionBetween(me.player, point),
      )
    : Option.none()
  if (Option.isSome(maybeDrop)) {
    return {
      move: fightMove(world, me, maybeNearest, maybeTarget),
      maybeAim: maybeDrop,
      trigger: 'Held',
      interact: 'Released',
    }
  }
  return {
    move: fightMove(world, me, maybeNearest, maybeTarget),
    maybeAim: Option.flatMap(maybeTarget, zombie =>
      Option.map(directionBetween(me.player, zombie), aim =>
        wanderedAim(aim, me.seat.slot, zombie.id, window),
      ),
    ),
    trigger:
      Option.isSome(maybeTarget) &&
      canShoot(me) &&
      (window + me.seat.slot) % EASE_OFF_EVERY !== 0
        ? 'Held'
        : 'Released',
    interact: 'Released',
  }
}

const humanReady = (world: World): boolean =>
  leadSeatOf(world).readiness === 'Ready'

const toBackDoor = (world: World, me: SeatState): Option.Option<Vector> =>
  Array.some(
    playersOf(world),
    mate =>
      mate.seat.slot !== me.seat.slot &&
      Purchase.matchOrElse(
        mate.purchase,
        { Holding: ({ target }) => Purchasable.isAnyOf(['BackDoor'])(target) },
        () => false,
      ),
  )
    ? Option.map(backDoorStandOf(levelOf(world)), spot =>
        distanceBetween(me.player, spot) <= BACK_DOOR_STOP_PX
          ? ZERO_VECTOR
          : walkToward(world, me.player, spot),
      )
    : Option.none()

const breakIntent = (world: World, me: SeatState): Intent => {
  if (!isStanding(me.seat)) {
    return idleIntent
  }
  const maybeToBackDoor = toBackDoor(world, me)
  if (Option.isSome(maybeToBackDoor)) {
    return { ...idleIntent, move: maybeToBackDoor.value }
  }
  const maybeToPickup = toPickup(world, me)
  if (Option.isSome(maybeToPickup)) {
    return { ...idleIntent, move: maybeToPickup.value }
  }
  const maybeSearch = searchMove(world, me)
  if (Option.isSome(maybeSearch)) {
    return { ...idleIntent, move: maybeSearch.value }
  }
  const pantry = pantryErrand(world)
  if (pantry !== undefined) {
    return { ...idleIntent, move: walkToward(world, me.player, pantry) }
  }
  if (me.seat.readiness === 'Ready') {
    return idleIntent
  }
  return { ...idleIntent, move: withElbowRoom(world, me, toPost(world, me)) }
}

const meleeReachOf = (me: SeatState, zombie: Zombie): number =>
  (hasPan(me.player) ? PAN_RULES.reachPx : KNIFE_RULES.reachPx) +
  bodyRadiusOf(zombie) +
  PLAYER_RADIUS

const downIntent = (world: World, me: SeatState): Intent =>
  Option.match(
    Option.filter(
      nearestShootable(world, me.player),
      zombie => distanceBetween(me.player, zombie) <= meleeReachOf(me, zombie),
    ),
    {
      onNone: () => idleIntent,
      onSome: zombie => ({
        ...idleIntent,
        maybeAim: directionBetween(me.player, zombie),
        trigger: 'Held',
      }),
    },
  )

const outThroughFrontDoor = (
  world: World,
  me: SeatState,
  intent: Intent,
): Intent =>
  isFrontDoorOpen(world)
    ? {
        ...intent,
        move: walkToward(world, me.player, frontDoorSillOf(levelOf(world))),
      }
    : intent

const intentFor = (world: World, slot: PlayerSlot): Intent =>
  Option.match(
    Array.findFirst(playersOf(world), player => player.seat.slot === slot),
    {
      onNone: () => idleIntent,
      onSome: me => {
        if (!isStanding(me.seat)) {
          return downIntent(world, me)
        }
        return Phase.match(world.phase, {
          Ready: () => idleIntent,
          Arriving: () => idleIntent,
          Preparation: () =>
            outThroughFrontDoor(world, me, breakIntent(world, me)),
          Wave: () => outThroughFrontDoor(world, me, fightIntent(world, me)),
          Paused: () => idleIntent,
          Escaped: () => idleIntent,
          LeftEarly: () => idleIntent,
          GameOver: () => idleIntent,
        })
      },
    },
  )

export const botInputs: {
  (slots: ReadonlyArray<PlayerSlot>): (world: World) => InputsByPlayer
  (world: World, slots: ReadonlyArray<PlayerSlot>): InputsByPlayer
} = Function.dual(
  2,
  (world: World, slots: ReadonlyArray<PlayerSlot>): InputsByPlayer =>
    new Map(Array.map(slots, slot => [slot, intentFor(world, slot)] as const)),
)

const isNobodyClose = (world: World, me: SeatState): boolean =>
  Option.match(nearestShootable(world, me.player), {
    onNone: () => true,
    onSome: zombie => distanceBetween(me.player, zombie) > RELOAD_QUIET_PX,
  })

const readyTimeOf = (world: World): number => clockMsOf(world)

const fightPress = (world: World, me: SeatState): Option.Option<SeatAction> =>
  canReload(me.player) &&
  heldLoaded(me.player) * 2 <
    carriedMagazine(me.player.calling, heldGun(me.player.arsenal)) &&
  isNobodyClose(world, me)
    ? Option.some(SeatAction.Reload())
    : Option.none()

const breakPress = (world: World, me: SeatState): Option.Option<SeatAction> => {
  const waitedMs = readyTimeOf(world)
  const isReadyNow =
    me.seat.readiness === 'Waiting' &&
    (humanReady(world) || waitedMs >= READY_DELAY_MS)
  return isReadyNow ? Option.some(SeatAction.Ready()) : Option.none()
}

const pressFor = (world: World, slot: PlayerSlot): Option.Option<SeatAction> =>
  Option.flatMap(
    Array.findFirst(playersOf(world), player => player.seat.slot === slot),
    me => {
      if (!isStanding(me.seat)) {
        return Option.none()
      }
      return Phase.match(world.phase, {
        Ready: () => Option.none(),
        Arriving: () => Option.none(),
        Preparation: () => breakPress(world, me),
        Wave: () => fightPress(world, me),
        Paused: () => Option.none(),
        Escaped: () => Option.none(),
        LeftEarly: () => Option.none(),
        GameOver: () => Option.none(),
      })
    },
  )

export const applyBotPresses: {
  (slots: ReadonlyArray<PlayerSlot>): (world: World) => World
  (world: World, slots: ReadonlyArray<PlayerSlot>): World
} = Function.dual(2, (world: World, slots: ReadonlyArray<PlayerSlot>): World =>
  Array.reduce(slots, world, (current, slot) =>
    Option.match(pressFor(current, slot), {
      onNone: () => current,
      onSome: action => applySeatAction(current, slot, action),
    }),
  ),
)
