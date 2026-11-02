import { Array, Option, Order, pipe } from 'effect'

import { hasClearPath, hasLineOfSight, levelOf } from './arena'
import { PLAYER_RADIUS, SHOP_NEAR_PX } from './constants'
import {
  ZERO_VECTOR,
  closestPointOnSegment,
  directionBetween,
  distanceBetween,
  normalize,
} from './geometry'
import {
  COOP_RULES,
  type SeatedPlayer,
  focusSeat,
  isDowned,
  isStanding,
  leadSeatOf,
  playersOf,
  shopOf,
} from './party'
import { flowFieldToward, steerToward } from './pathing'
import { STALL_BOX, Verdict, isShopOpenFor, verdictFor } from './shop'
import { type InputsByPlayer, SeatAction, applySeatAction } from './stepWorld'
import {
  canReload,
  carriedMagazine,
  heldGun,
  heldLoaded,
  isReloading,
} from './weapons'
import type { World } from './world'
import {
  type Intent,
  Phase,
  type PlayerSlot,
  type ShopItemId,
  ShopState,
  type Vector,
  type Zombie,
  idleIntent,
} from './worldSchema'

// A teammate bot's brain (GAME_DESIGN.md, "Teammate bots"): the seat's
// intent and its presses for a tick, read from the World alone. It plays
// like a competent casual: it shoots the nearest zombie it can see, keeps
// some distance from it, stays by the human, revives anyone who is down,
// buys ammo and hearts at the stall in a break (never while the human is at
// it), and presses READY when the human does or after a short wait. It
// carries nothing between ticks and rolls no dice, so the same World gives
// the same intent, and a replay holds.

// TUNING

const FIRE_RANGE_PX = 100
const FOLLOW_NEAR_PX = 16
const FOLLOW_FAR_PX = 52
const STRAFE_MS = 1300
const RELOAD_QUIET_PX = 90
const REVIVE_STOP_PX = PLAYER_RADIUS + COOP_RULES.reviveReachPx - 4
const READY_DELAY_MS = 4000
const READY_LIMIT_MS = 10_000
const STALL_YIELD_PX = SHOP_NEAR_PX
const STALL_SPOT_PX = 8

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

// NOTE: the human is the seat in the World's own fields; the bot stays by
// them, or by the nearest teammate on its feet when they are out.
const anchorFor = (
  world: World,
  me: SeatedPlayer,
): Option.Option<SeatedPlayer> => {
  const others = Array.filter(
    playersOf(world),
    other => other.slot !== me.slot && isStanding(other.seat),
  )
  const humanSlot = leadSeatOf(world).slot
  return pipe(
    Array.findFirst(others, other => other.slot === humanSlot),
    Option.orElse(() =>
      Array.head(
        Array.sort(
          others,
          Order.mapInput(Order.Number, (other: SeatedPlayer) =>
            distanceBetween(me.player, other.player),
          ),
        ),
      ),
    ),
  )
}

const downedNear = (
  world: World,
  me: SeatedPlayer,
): Option.Option<SeatedPlayer> =>
  pipe(
    playersOf(world),
    Array.filter(other => other.slot !== me.slot && isDowned(other.seat)),
    Array.sort(
      Order.mapInput(Order.Number, (other: SeatedPlayer) =>
        distanceBetween(me.player, other.player),
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

// NOTE: where each bot stands by the human: a spot beside them, a little
// different for every seat.
const SPOT_OFFSETS: ReadonlyArray<Vector> = [
  { x: 0, y: 0 },
  { x: -22, y: 10 },
  { x: 22, y: 10 },
  { x: 0, y: -22 },
]

const spotBeside = (anchor: Vector, slot: PlayerSlot): Vector => {
  const offset = Option.getOrElse(
    Array.get(SPOT_OFFSETS, slot % SPOT_OFFSETS.length),
    () => ZERO_VECTOR,
  )
  return { x: anchor.x + offset.x, y: anchor.y + offset.y }
}

// THE FIGHT

const clockMsOf = (world: World): number =>
  Phase.match(world.phase, {
    Ready: () => 0,
    Preparation: preparation =>
      preparation.durationMs - preparation.remainingMs,
    Wave: wave => wave.elapsedMs,
    Paused: () => 0,
    Victory: () => 0,
    GameOver: () => 0,
  })

// NOTE: on Nightmare a teammate's shot wounds, so the bot holds fire with
// a teammate near the line.
const isMateInLine = (
  world: World,
  me: SeatedPlayer,
  target: Vector,
): boolean =>
  world.difficulty.chosen === 'Nightmare' &&
  Array.some(
    playersOf(world),
    other =>
      other.slot !== me.slot &&
      isStanding(other.seat) &&
      distanceBetween(
        closestPointOnSegment(other.player, me.player, target),
        other.player,
      ) <
        PLAYER_RADIUS + 3,
  )

const maybeTargetFor = (
  world: World,
  me: SeatedPlayer,
): Option.Option<Zombie> =>
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

const canShoot = (me: SeatedPlayer): boolean =>
  !isReloading(me.player) && (heldLoaded(me.player) > 0 || canReload(me.player))

const fleeFrom = (me: SeatedPlayer, zombie: Zombie): Option.Option<Zombie> =>
  distanceBetween(me.player, zombie) < FLEE_PX[zombie.kind]
    ? Option.some(zombie)
    : Option.none()

const fightMove = (
  world: World,
  me: SeatedPlayer,
  maybeNearest: Option.Option<Zombie>,
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
    return mixed(
      awayFrom(me.player, maybeDanger.value),
      sideStep(me.player, maybeDanger.value, me.slot, clockMs),
      0.5,
    )
  }
  if (Option.isSome(maybeDowned)) {
    return reviveStop
      ? ZERO_VECTOR
      : walkToward(world, me.player, maybeDowned.value.player)
  }
  return Option.match(anchorFor(world, me), {
    onNone: () => ZERO_VECTOR,
    onSome: anchor => {
      const gap = distanceBetween(me.player, anchor.player)
      if (gap > FOLLOW_FAR_PX) {
        return walkToward(world, me.player, spotBeside(anchor.player, me.slot))
      } else if (gap < FOLLOW_NEAR_PX) {
        return awayFrom(me.player, anchor.player)
      } else {
        return Option.match(maybeNearest, {
          onNone: () => ZERO_VECTOR,
          onSome: zombie =>
            distanceBetween(me.player, zombie) < FIRE_RANGE_PX / 2
              ? mixed(
                  ZERO_VECTOR,
                  sideStep(me.player, zombie, me.slot, clockMs),
                  0.6,
                )
              : ZERO_VECTOR,
        })
      }
    },
  })
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

const fightIntent = (world: World, me: SeatedPlayer): Intent => {
  const maybeNearest = nearestShootable(world, me.player)
  const maybeTarget = maybeTargetFor(world, me)
  const window = Math.floor(clockMsOf(world) / HAND_WINDOW_MS)
  return {
    move: fightMove(world, me, maybeNearest),
    maybeAim: Option.flatMap(maybeTarget, zombie =>
      Option.map(directionBetween(me.player, zombie), aim =>
        wanderedAim(aim, me.slot, zombie.id, window),
      ),
    ),
    trigger:
      Option.isSome(maybeTarget) &&
      canShoot(me) &&
      (window + me.slot) % EASE_OFF_EVERY !== 0
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
    Verdict.isAnyOf(['Available'])(verdictFor(seatWorld, item)),
  )

const isShopOpen = (world: World): boolean => isShopOpenFor(world.phase)

const isHumanBusyAtStall = (world: World, human: SeatedPlayer): boolean =>
  distanceToStall(human.player) < STALL_YIELD_PX ||
  Option.exists(shopOf(world, human.slot), shop =>
    ShopState.isAnyOf(['Browsing'])(shop),
  )

const humanReady = (world: World): boolean =>
  leadSeatOf(world).readiness === 'Ready'

const humanOf = (world: World): Option.Option<SeatedPlayer> =>
  Array.findFirst(
    playersOf(world),
    ({ slot }) => slot === leadSeatOf(world).slot,
  )

const breakIntent = (world: World, me: SeatedPlayer): Intent => {
  const maybeHuman = humanOf(world)
  const seatWorld = focusSeat(world, me.slot)
  const isAtCounter = ShopState.isAnyOf(['Browsing'])(seatWorld.shop)
  if (!isStanding(me.seat) || isAtCounter || me.seat.readiness === 'Ready') {
    return idleIntent
  }
  const wantsShop = isShopOpen(world) && Option.isSome(maybeWishOf(seatWorld))
  const stallIsFree = Option.match(maybeHuman, {
    onNone: () => true,
    onSome: human =>
      human.slot === me.slot || !isHumanBusyAtStall(world, human),
  })
  if (
    wantsShop &&
    stallIsFree &&
    !ShopState.isAnyOf(['Dismissed'])(seatWorld.shop)
  ) {
    return { ...idleIntent, move: walkToward(world, me.player, stallSpot) }
  }
  return Option.match(anchorFor(world, me), {
    onNone: () => idleIntent,
    onSome: anchor => ({
      ...idleIntent,
      move:
        distanceBetween(me.player, anchor.player) > FOLLOW_FAR_PX
          ? walkToward(world, me.player, spotBeside(anchor.player, me.slot))
          : distanceBetween(me.player, anchor.player) < FOLLOW_NEAR_PX
            ? awayFrom(me.player, anchor.player)
            : ZERO_VECTOR,
    }),
  })
}

// INTENT

const intentFor = (world: World, slot: PlayerSlot): Intent =>
  Option.match(
    Array.findFirst(playersOf(world), player => player.slot === slot),
    {
      onNone: () => idleIntent,
      onSome: me => {
        if (!isStanding(me.seat)) {
          return idleIntent
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

const isNobodyClose = (world: World, me: SeatedPlayer): boolean =>
  Option.match(nearestShootable(world, me.player), {
    onNone: () => true,
    onSome: zombie => distanceBetween(me.player, zombie) > RELOAD_QUIET_PX,
  })

const readyTimeOf = (world: World): number => clockMsOf(world)

const fightPress = (
  world: World,
  me: SeatedPlayer,
): Option.Option<SeatAction> =>
  canReload(me.player) &&
  heldLoaded(me.player) * 2 <
    carriedMagazine(me.player.calling, heldGun(me.player.arsenal)) &&
  isNobodyClose(world, me)
    ? Option.some(SeatAction.Reload())
    : Option.none()

const breakPress = (
  world: World,
  me: SeatedPlayer,
): Option.Option<SeatAction> => {
  const seatWorld = focusSeat(world, me.slot)
  const maybeWish = maybeWishOf(seatWorld)
  if (ShopState.isAnyOf(['Browsing'])(seatWorld.shop)) {
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
    ShopState.isAnyOf(['Dismissed'])(seatWorld.shop)
  const isReadyNow =
    me.seat.readiness === 'Waiting' &&
    ((isDone && (humanReady(world) || waitedMs >= READY_DELAY_MS)) ||
      waitedMs >= READY_LIMIT_MS)
  return isReadyNow ? Option.some(SeatAction.Ready()) : Option.none()
}

const pressFor = (world: World, slot: PlayerSlot): Option.Option<SeatAction> =>
  Option.flatMap(
    Array.findFirst(playersOf(world), player => player.slot === slot),
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
