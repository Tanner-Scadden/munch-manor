import { Array, Option, Order, Result, pipe } from 'effect'

import {
  type Level,
  boxCenter,
  hasClearPath,
  hasLineOfSight,
  isInYardAt,
  isInsideRoomAt,
  isSolidAt,
  levelOf,
} from './arena'
import { maxHpOf } from './calling'
import { PLAYER_RADIUS, PLAYER_SPEED, SHOP_NEAR_PX } from './constants'
import { type Threat, escapeHeading } from './escape'
import { PAN_RULES } from './fridgeWeapons'
import {
  ZERO_VECTOR,
  closestPointOnSegment,
  directionBetween,
  distanceBetween,
  normalize,
} from './geometry'
import { KNIFE_RULES } from './knife'
import { isCallFresh } from './medic'
import {
  COOP_RULES,
  focusOf,
  focusSeat,
  focusSlotOf,
  isDowned,
  isFriendlyFireOn,
  isStanding,
  leadSeatOf,
  playersOf,
  shopOf,
} from './party'
import { flowFieldToward, steerToward } from './pathing'
import { PICKUP_LIFETIME_MS } from './powerups'
import { STALL_BOX, Verdict, isShopOpenFor, verdictFor } from './shop'
import { type InputsByPlayer, SeatAction, applySeatAction } from './stepWorld'
import {
  canReload,
  carriedMagazine,
  hasPan,
  heldGun,
  heldLoaded,
  isReloading,
} from './weapons'
import type { World } from './world'
import {
  BreakClock,
  type Intent,
  Phase,
  type Pickup,
  type PlayerSlot,
  type SeatState,
  type ShopItemId,
  ShopState,
  type Vector,
  type Zombie,
  idleIntent,
} from './worldSchema'
import { bodyRadiusOf } from './zombies'

// A teammate bot's brain (GAME_DESIGN.md, "Teammate bots"): the seat's
// intent and its presses for a tick, read from the World alone. It plays
// like a competent casual with a mind of its own: it holds its own post by a
// door (a different one for each seat, moving on now and then), hunts the
// zombies it hears but cannot see, shoots the nearest one it can, keeps
// some distance from it and some room from its teammates, revives anyone who
// is down (a fresh MEDIC! call first, over any power-up), grabs the power-ups nobody nearer wants, buys ammo and hearts at the stall in a break (never while the
// human is at it), and presses READY when the human does or after a short
// wait. It
// carries nothing between ticks and rolls no dice, so the same World gives
// the same intent, and a replay holds.

// TUNING

const FIRE_RANGE_PX = 100
const ELBOW_ROOM_PX = 18
const HUNT_PX = 170
const POST_INSET_PX = 30
const POST_REACHED_PX = 10
const POST_MS = 14_000
const STRAFE_MS = 1300
const RELOAD_QUIET_PX = 90
const REVIVE_STOP_PX = PLAYER_RADIUS + COOP_RULES.reviveReachPx - 4
const READY_DELAY_MS = 4000
const READY_LIMIT_MS = 10_000
const STALL_YIELD_PX = SHOP_NEAR_PX
const STALL_SPOT_PX = 8
const THREAT_SLACK_PX = 40
const PICKUP_SEEK_PX = 110
const HEART_SEEK_PX = 170
const PICKUP_SAFE_PX = 28
const LOW_HP = 2

// NOTE: how close a zombie may come before the bot backs off it. The big
// and the explosive ones get more room.
const FLEE_PX: Readonly<Record<Zombie['kind'], number>> = {
  Shambler: 24,
  Runner: 26,
  Tank: 34,
  Exploder: 40,
  Thrower: 26,
  Crawler: 20,
  Boss: 56,
}

const WISHES: ReadonlyArray<ShopItemId> = [
  'LidStack',
  'ShotgunShells',
  'SmgRounds',
  'Heart',
  'PistolUpgrade',
  'ShotgunUpgrade',
  'SmgUpgrade',
  'CookerUpgrade',
]

// WHAT IS IN THE ROOM

const OUT_OF_REACH = ['Burrowed', 'Carried', 'Flying'] as const

const isShootable = (zombie: Zombie): boolean =>
  zombie.state._tag === 'Walking' &&
  !Array.contains(OUT_OF_REACH, zombie.action._tag)

const byDistanceFrom = (at: Vector) =>
  Order.mapInput(Order.Number, (zombie: Zombie) => distanceBetween(at, zombie))

// NOTE: one pass, no sorting: this runs for every bot on every tick.
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

// NOTE: a fresh MEDIC! call (src/medic.ts) comes first, then the nearest.
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

// WALKING

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

// NOTE: a step to the side of the danger, which side by the bot's seat and
// the wave's clock, so a crew does not all circle the same way.
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

// NOTE: a bot's post: a spot inside the house a little way in from a door,
// where it watches for what comes through. Built once for each Level.
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

// NOTE: which post a seat holds: its own, by slot, moving on to the next
// door every POST_MS of the clock, so a crew spreads over the house and
// each bot wanders it in its own order.
const postOf = (world: World, slot: PlayerSlot): Vector => {
  const posts = postsOf(levelOf(world))
  const turn = Math.floor(clockMsOf(world) / POST_MS)
  const index = (slot * 2 + turn) % posts.length
  return Option.getOrElse(Array.get(posts, index), () =>
    boxCenter(levelOf(world).bounds),
  )
}

// NOTE: a step away from the nearest teammate on their feet when they are
// too close, so a crew does not walk in a clump.
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

// THE FIGHT

const clockMsOf = (world: World): number =>
  Phase.match(world.phase, {
    Ready: () => 0,
    Preparation: ({ clock, durationMs, remainingMs }) =>
      BreakClock.match(clock, {
        Counting: () => durationMs - remainingMs,
        Waiting: ({ elapsedMs }) => elapsedMs,
      }),
    Wave: wave => wave.elapsedMs,
    Paused: () => 0,
    Victory: () => 0,
    GameOver: () => 0,
  })

// NOTE: with the Friendly Fire modifier on a teammate's shot wounds, so
// the bot holds fire with a teammate near the line.
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

// NOTE: every zombie close enough to matter when the bot runs, so it runs
// clear of the crowd and not only of the nearest.
const threatsNear = (world: World, me: SeatState): ReadonlyArray<Threat> =>
  Array.filterMap(world.zombies, zombie =>
    isShootable(zombie) &&
    distanceBetween(me.player, zombie) < FLEE_PX[zombie.kind] + THREAT_SLACK_PX
      ? Result.succeed({ at: zombie, radius: bodyRadiusOf(zombie) })
      : Result.failVoid,
  )

// POWER-UPS

// NOTE: whether a player would want this pickup: a Heart only when hurt.
const wants = (player: SeatState, pickup: Pickup): boolean =>
  pickup.kind !== 'Heart' || player.player.hp < maxHpOf(player.player)

// NOTE: the pickup the bot goes for, the way a teammate would: one it can
// reach before it vanishes, with no zombie standing on it, and that it is
// the nearest of the players who want it to, so it never races the human
// or another bot for it. It reaches further for a Heart when low.
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

// NOTE: a casual hand, without dice: every quarter second the bot's aim
// wanders a little off its target and it eases off the trigger one window
// in four. The wander is a hash of the seat, the zombie, and the window, so
// the same World gives the same shot.
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
    x: aim.x * Math.cos(turn) - aim.y * Math.sin(turn),
    y: aim.x * Math.sin(turn) + aim.y * Math.cos(turn),
  }
}

const fightIntent = (world: World, me: SeatState): Intent => {
  const maybeNearest = nearestShootable(world, me.player)
  const maybeTarget = maybeTargetFor(world, me)
  const window = Math.floor(clockMsOf(world) / HAND_WINDOW_MS)
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

// THE BREAK

const stallSpot: Vector = {
  x: STALL_BOX.left - STALL_SPOT_PX,
  y: (STALL_BOX.top + STALL_BOX.bottom) / 2,
}

const distanceToStall = ({ x, y }: Vector): number =>
  Math.hypot(
    Math.max(STALL_BOX.left - x, 0, x - STALL_BOX.right),
    Math.max(STALL_BOX.top - y, 0, y - STALL_BOX.bottom),
  )

// NOTE: the first thing on the bot's list that it can buy right now, from
// its own wallet and guns (the seat in the World's fields).
const maybeWishOf = (seatWorld: World): Option.Option<ShopItemId> =>
  Array.findFirst(WISHES, item =>
    Verdict.isAnyOf(['Available'])(
      verdictFor(seatWorld, focusSlotOf(seatWorld), item),
    ),
  )

const isShopOpen = (world: World): boolean => isShopOpenFor(world.phase)

const isHumanBusyAtStall = (world: World, human: SeatState): boolean =>
  distanceToStall(human.player) < STALL_YIELD_PX ||
  Option.exists(shopOf(world, human.seat.slot), shop =>
    ShopState.isAnyOf(['Browsing'])(shop),
  )

const humanReady = (world: World): boolean =>
  leadSeatOf(world).readiness === 'Ready'

const humanOf = (world: World): Option.Option<SeatState> =>
  Array.findFirst(
    playersOf(world),
    ({ seat }) => seat.slot === leadSeatOf(world).slot,
  )

const breakIntent = (world: World, me: SeatState): Intent => {
  const maybeHuman = humanOf(world)
  const seatWorld = focusSeat(world, me.seat.slot)
  const isAtCounter = ShopState.isAnyOf(['Browsing'])(focusOf(seatWorld).shop)
  if (!isStanding(me.seat) || isAtCounter) {
    return idleIntent
  }
  const maybeToPickup = toPickup(world, me)
  if (Option.isSome(maybeToPickup)) {
    return { ...idleIntent, move: maybeToPickup.value }
  }
  if (me.seat.readiness === 'Ready') {
    return idleIntent
  }
  const wantsShop = isShopOpen(world) && Option.isSome(maybeWishOf(seatWorld))
  const stallIsFree = Option.match(maybeHuman, {
    onNone: () => true,
    onSome: human =>
      human.seat.slot === me.seat.slot || !isHumanBusyAtStall(world, human),
  })
  if (
    wantsShop &&
    stallIsFree &&
    !ShopState.isAnyOf(['Dismissed'])(focusOf(seatWorld).shop)
  ) {
    return { ...idleIntent, move: walkToward(world, me.player, stallSpot) }
  }
  return { ...idleIntent, move: withElbowRoom(world, me, toPost(world, me)) }
}

// INTENT

// NOTE: a bot that is down lies where it fell and swings its knife or Pan
// at any zombie in reach, as a player who is down can.
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
          Preparation: () => breakIntent(world, me),
          Wave: () => fightIntent(world, me),
          Paused: () => idleIntent,
          Victory: () => idleIntent,
          GameOver: () => idleIntent,
        })
      },
    },
  )

// NOTE: each bot's intent for the tick, keyed by its slot, to join the
// human's in the step's inputs.
export const botInputs = (
  world: World,
  slots: ReadonlyArray<PlayerSlot>,
): InputsByPlayer =>
  new Map(Array.map(slots, slot => [slot, intentFor(world, slot)] as const))

// PRESSES

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
  const seatWorld = focusSeat(world, me.seat.slot)
  const maybeWish = maybeWishOf(seatWorld)
  if (ShopState.isAnyOf(['Browsing'])(focusOf(seatWorld).shop)) {
    return Option.some(
      Option.match(maybeWish, {
        onNone: () => SeatAction.LeaveCounter(),
        onSome: item => SeatAction.Buy({ item }),
      }),
    )
  }
  const waitedMs = readyTimeOf(world)
  const isDone =
    !isShopOpen(world) ||
    Option.isNone(maybeWish) ||
    ShopState.isAnyOf(['Dismissed'])(focusOf(seatWorld).shop)
  const isReadyNow =
    me.seat.readiness === 'Waiting' &&
    ((isDone && (humanReady(world) || waitedMs >= READY_DELAY_MS)) ||
      waitedMs >= READY_LIMIT_MS)
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
        Preparation: () => breakPress(world, me),
        Wave: () => fightPress(world, me),
        Paused: () => Option.none(),
        Victory: () => Option.none(),
        GameOver: () => Option.none(),
      })
    },
  )

// NOTE: the bots' presses for the tick (reload in a lull, buy and leave the
// counter, READY), applied to their seats before the step, through the same
// seat actions a player's presses are.
export const applyBotPresses = (
  world: World,
  slots: ReadonlyArray<PlayerSlot>,
): World =>
  Array.reduce(slots, world, (current, slot) =>
    Option.match(pressFor(current, slot), {
      onNone: () => current,
      onSome: action => applySeatAction(current, slot, action),
    }),
  )
