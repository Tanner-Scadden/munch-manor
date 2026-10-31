import { Array, Option, Order, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Level, hasLineOfSight, levelOf } from './arena'
import { woundPlayer } from './combat'
import { MS_PER_SECOND, PLAYER_RADIUS, ZOMBIE_HIT_PULSE_MS } from './constants'
import {
  OUTWARD,
  ZERO_VECTOR,
  directionBetween,
  distanceBetween,
  normalize,
} from './geometry'
import { facingNearest, forEachSeatWhere, isStanding } from './party'
import type { World } from './world'
import {
  GameEvent,
  Invulnerability,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from './worldSchema'
import {
  ZOMBIE_KINDS,
  bodyRadiusOf,
  isFree,
  isWalking,
  wearOf,
} from './zombies'

// RULES

type ChuckerRules = {
  grabReachPx: number
  fetchPx: number
  hangPx: number
  throwMinPx: number
  throwMaxPx: number
  heftMs: number
  flightMs: number
  landRadius: number
  landDamage: number
  dazedMs: number
  windedMs: number
  arrivalWindedMs: number
  limpHeftScale: number
  shieldTriggerPx: number
  shieldReachPx: number
  shieldMs: number
  shieldCooldownMs: number
  shieldTurnPerSecond: number
  shieldArcCos: number
  shieldHoldPx: number
  shieldDropDazedMs: number
}

export const CHUCKER_RULES: ChuckerRules = {
  grabReachPx: 10,
  fetchPx: 70,
  hangPx: 64,
  throwMinPx: 28,
  throwMaxPx: 150,
  heftMs: 900,
  flightMs: 900,
  landRadius: 12,
  landDamage: 1,
  dazedMs: 1000,
  windedMs: 3200,
  arrivalWindedMs: 1500,
  limpHeftScale: 1.5,
  shieldTriggerPx: 50,
  shieldReachPx: 20,
  shieldMs: 4000,
  shieldCooldownMs: 2600,
  shieldTurnPerSecond: 1.4,
  shieldArcCos: 0.5,
  shieldHoldPx: 7,
  shieldDropDazedMs: 600,
}

export const THROWER_KIND = 'Thrower'

const LIMP_ARM_STAGE = ZOMBIE_KINDS.Thrower.wear.length

const isChucker = (zombie: Zombie): boolean => zombie.kind === THROWER_KIND

const isThrowable = (zombie: Zombie): boolean =>
  zombie.kind === 'Shambler' && isFree(zombie)

// STEERING

const byDistanceFrom = (from: Vector) =>
  Order.mapInput(Order.Number, (zombie: Zombie) =>
    distanceBetween(from, zombie),
  )

const nearestThrowable = (
  chucker: Zombie,
  zombies: ReadonlyArray<Zombie>,
): Option.Option<Zombie> =>
  pipe(
    zombies,
    Array.filter(isThrowable),
    Array.sort(byDistanceFrom(chucker)),
    Array.head,
  )

// NOTE: a Big Leaguer hangs back once it is close enough to throw and waits for
// a Groaner to wander past. It walks to fetch a Groaner it can see nearby,
// and walks in to bite like any other zombie when there is none to throw.
// None means it follows the flow field like the rest; Some is its own
// heading, which is still while it holds its ground.
export const maybeChuckerHeading = (
  level: Level,
  chucker: Zombie,
  zombies: ReadonlyArray<Zombie>,
  player: Vector,
): Option.Option<Vector> =>
  Option.flatMap(nearestThrowable(chucker, zombies), groaner => {
    const isRested = ZombieAction.isAnyOf(['Roaming'])(chucker.action)
    if (
      isRested &&
      distanceBetween(chucker, groaner) <= CHUCKER_RULES.fetchPx &&
      hasLineOfSight(level, chucker, groaner)
    ) {
      return Option.orElse(
        normalize({ x: groaner.x - chucker.x, y: groaner.y - chucker.y }),
        () => Option.some(ZERO_VECTOR),
      )
    } else if (distanceBetween(chucker, player) <= CHUCKER_RULES.hangPx) {
      return Option.some(ZERO_VECTOR)
    } else {
      return Option.none()
    }
  })

// GRABBING

const isInThrowRange = (
  level: Level,
  chucker: Zombie,
  player: Player,
): boolean => {
  const distance = distanceBetween(chucker, player)
  return (
    distance >= CHUCKER_RULES.throwMinPx &&
    distance <= CHUCKER_RULES.throwMaxPx &&
    hasLineOfSight(level, chucker, player)
  )
}

const isWithinGrab = (chucker: Zombie) => (groaner: Zombie) =>
  distanceBetween(chucker, groaner) <=
  bodyRadiusOf(chucker) + bodyRadiusOf(groaner) + CHUCKER_RULES.grabReachPx

const setAction =
  (id: number, action: ZombieAction) =>
  (zombie: Zombie): Zombie =>
    zombie.id === id ? modifyFields(zombie, { action: () => action }) : zombie

// NOTE: once his throwing arm hangs limp (his last wear stage), he winds up
// one-handed and slower.
const heftMsOf = (chucker: Zombie): number =>
  wearOf(chucker) >= LIMP_ARM_STAGE
    ? CHUCKER_RULES.heftMs * CHUCKER_RULES.limpHeftScale
    : CHUCKER_RULES.heftMs

const tryGrab = (model: World, chucker: Zombie): World => {
  if (
    !ZombieAction.isAnyOf(['Roaming'])(chucker.action) ||
    !isWalking(chucker) ||
    !isInThrowRange(levelOf(model), chucker, model.player)
  ) {
    return model
  }

  return Option.match(
    pipe(
      model.zombies,
      Array.filter(isThrowable),
      Array.filter(isWithinGrab(chucker)),
      Array.sort(byDistanceFrom(chucker)),
      Array.head,
    ),
    {
      onNone: () => model,
      onSome: victim =>
        modifyFields(model, {
          zombies: zombies =>
            Array.map(zombies, zombie =>
              pipe(
                zombie,
                setAction(
                  chucker.id,
                  ZombieAction.Hefting({
                    victimId: victim.id,
                    remainingMs: heftMsOf(chucker),
                    durationMs: heftMsOf(chucker),
                  }),
                ),
                setAction(
                  victim.id,
                  ZombieAction.Carried({ byId: chucker.id }),
                ),
              ),
            ),
          frameEvents: Array.append(
            GameEvent.ZombieGrabbed({ x: chucker.x, y: chucker.y }),
          ),
        }),
    },
  )
}

// HEAVING

const findZombie = (
  zombies: ReadonlyArray<Zombie>,
  id: number,
): Option.Option<Zombie> => Array.findFirst(zombies, zombie => zombie.id === id)

const isCarriedBy = (chucker: Zombie) => (victim: Zombie) =>
  isWalking(victim) &&
  ZombieAction.isAnyOf(['Carried'])(victim.action) &&
  victim.action.byId === chucker.id

const windChucker = (model: World, chucker: Zombie): World =>
  modifyFields(model, {
    zombies: Array.map(
      setAction(
        chucker.id,
        ZombieAction.Winded({ remainingMs: CHUCKER_RULES.windedMs }),
      ),
    ),
  })

const release = (model: World, chucker: Zombie, victim: Zombie): World => {
  const target = { x: model.player.x, y: model.player.y }
  return modifyFields(windChucker(model, chucker), {
    zombies: Array.map(
      setAction(
        victim.id,
        ZombieAction.Flying({
          from: { x: chucker.x, y: chucker.y },
          to: target,
          remainingMs: CHUCKER_RULES.flightMs,
          durationMs: CHUCKER_RULES.flightMs,
        }),
      ),
    ),
    frameEvents: Array.append(
      GameEvent.ZombieThrown({ x: chucker.x, y: chucker.y }),
    ),
  })
}

const stepHeft = (model: World, chucker: Zombie, deltaMs: number): World => {
  if (!ZombieAction.isAnyOf(['Hefting'])(chucker.action)) {
    return model
  }

  const { victimId, remainingMs, durationMs } = chucker.action
  return Option.match(
    Option.filter(findZombie(model.zombies, victimId), isCarriedBy(chucker)),
    {
      onNone: () => windChucker(model, chucker),
      onSome: victim =>
        remainingMs > deltaMs
          ? modifyFields(model, {
              zombies: Array.map(
                setAction(
                  chucker.id,
                  ZombieAction.Hefting({
                    victimId,
                    remainingMs: remainingMs - deltaMs,
                    durationMs,
                  }),
                ),
              ),
            })
          : release(model, chucker, victim),
    },
  )
}

// CARRYING AND FLIGHT

const isHolding = (zombies: ReadonlyArray<Zombie>, victim: Zombie) =>
  Option.exists(
    Option.flatMap(
      ZombieAction.isAnyOf(['Carried'])(victim.action)
        ? Option.some(victim.action.byId)
        : Option.none(),
      byId => findZombie(zombies, byId),
    ),
    carrier =>
      isWalking(carrier) &&
      ZombieAction.isAnyOf(['Hefting'])(carrier.action) &&
      carrier.action.victimId === victim.id,
  )

const flightPoint = (from: Vector, to: Vector, progress: number): Vector => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
})

const dazed = (): ZombieAction =>
  ZombieAction.Dazed({
    remainingMs: CHUCKER_RULES.dazedMs,
    durationMs: CHUCKER_RULES.dazedMs,
  })

const isShielding = (zombies: ReadonlyArray<Zombie>, victim: Zombie) =>
  ZombieAction.isAnyOf(['Shielded'])(victim.action) &&
  Option.exists(
    findZombie(zombies, victim.action.byId),
    carrier =>
      isWalking(carrier) &&
      ZombieAction.isAnyOf(['Shielding'])(carrier.action) &&
      carrier.action.victimId === victim.id,
  )

const holdUp = (zombies: ReadonlyArray<Zombie>, victim: Zombie): Zombie => {
  if (!ZombieAction.isAnyOf(['Shielded'])(victim.action)) {
    return victim
  }

  const byId = victim.action.byId
  return Option.match(
    Option.filter(findZombie(zombies, byId), () =>
      isShielding(zombies, victim),
    ),
    {
      onNone: () => modifyFields(victim, { action: dazed }),
      onSome: carrier =>
        Option.match(shieldAim(carrier), {
          onNone: () => victim,
          onSome: aim =>
            modifyFields(victim, {
              x: () => carrier.x + Math.cos(aim) * CHUCKER_RULES.shieldHoldPx,
              y: () => carrier.y + Math.sin(aim) * CHUCKER_RULES.shieldHoldPx,
              knockback: () => ({ x: 0, y: 0 }),
            }),
        }),
    },
  )
}

// NOTE: a Groaner whose Big Leaguer is shot down mid-heave drops where it is,
// dazed, as if it had landed there.
const carry = (zombies: ReadonlyArray<Zombie>) => (zombie: Zombie) => {
  if (ZombieAction.isAnyOf(['Shielded'])(zombie.action)) {
    return isWalking(zombie) ? holdUp(zombies, zombie) : zombie
  }
  if (!ZombieAction.isAnyOf(['Carried'])(zombie.action)) {
    return zombie
  }

  return Option.match(findZombie(zombies, zombie.action.byId), {
    onNone: () => modifyFields(zombie, { action: dazed }),
    onSome: carrier =>
      isHolding(zombies, zombie)
        ? modifyFields(zombie, {
            x: () => carrier.x,
            y: () => carrier.y,
            knockback: () => ({ x: 0, y: 0 }),
          })
        : modifyFields(zombie, { action: dazed }),
  })
}

type Landing = Readonly<{ id: number; at: Vector }>

const fly =
  (deltaMs: number) =>
  (zombie: Zombie): Zombie => {
    if (!ZombieAction.isAnyOf(['Flying'])(zombie.action)) {
      return zombie
    }

    const { from, to, remainingMs, durationMs } = zombie.action
    if (remainingMs <= deltaMs) {
      return modifyFields(zombie, {
        x: () => to.x,
        y: () => to.y,
        knockback: () => ({ x: 0, y: 0 }),
        action: dazed,
      })
    }

    const left = remainingMs - deltaMs
    const point = flightPoint(from, to, 1 - left / Math.max(1, durationMs))
    return modifyFields(zombie, {
      x: () => point.x,
      y: () => point.y,
      knockback: () => ({ x: 0, y: 0 }),
      action: () =>
        ZombieAction.Flying({ from, to, remainingMs: left, durationMs }),
    })
  }

const landings = (
  zombies: ReadonlyArray<Zombie>,
  deltaMs: number,
): ReadonlyArray<Landing> =>
  Array.filterMap(zombies, zombie =>
    ZombieAction.isAnyOf(['Flying'])(zombie.action) &&
    zombie.action.remainingMs <= deltaMs
      ? Result.succeed({ id: zombie.id, at: zombie.action.to })
      : Result.failVoid,
  )

// NOTE: a thrown zombie lands on whoever stands under it: every standing
// player in co-op.
const land = (model: World, landing: Landing): World =>
  forEachSeatWhere(
    modifyFields(model, {
      frameEvents: Array.append(
        GameEvent.ZombieLanded({
          x: landing.at.x,
          y: landing.at.y,
          radius: CHUCKER_RULES.landRadius,
        }),
      ),
    }),
    isStanding,
    landed => landOn(landed, landing),
  )

const landOn = (landed: World, landing: Landing): World => {
  const { player } = landed
  const isHit =
    Invulnerability.isAnyOf(['Vulnerable'])(player.invulnerability) &&
    distanceBetween(landing.at, player) <=
      CHUCKER_RULES.landRadius + PLAYER_RADIUS
  if (!isHit) {
    return landed
  }

  const direction = Option.getOrElse(
    directionBetween(landing.at, player),
    () => OUTWARD,
  )
  return modifyFields(landed, {
    player: () => woundPlayer(player, CHUCKER_RULES.landDamage, direction),
    frameEvents: Array.append(
      GameEvent.PlayerHurt({
        x: player.x,
        y: player.y,
        direction,
        source: 'Thrower',
      }),
    ),
  })
}

// SHIELDING

const SHIELD_KINDS: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Crawler',
]

const isShieldable = (zombie: Zombie): boolean =>
  Array.contains(SHIELD_KINDS, zombie.kind) && isFree(zombie)

const byShieldPreference = (from: Vector) =>
  Order.combine(
    Order.mapInput(Order.Number, (zombie: Zombie) =>
      zombie.kind === 'Shambler' ? 0 : 1,
    ),
    byDistanceFrom(from),
  )

const angleBetween = (from: Vector, to: Vector): number =>
  Math.atan2(to.y - from.y, to.x - from.x)

const isUnderThreat = (chucker: Zombie, player: Player): boolean =>
  distanceBetween(chucker, player) <= CHUCKER_RULES.shieldTriggerPx ||
  chucker.hitRemainingMs > 0

// NOTE: a Big Leaguer the player crowds, or one taking hits, yanks the
// nearest small zombie in front of him as a shield: a Groaner if one is in
// reach, otherwise a Hotfoot or an Ankle Biter, never a Kaboomer, a Big Lug,
// or the boss.
const tryShield = (model: World, chucker: Zombie): World => {
  if (
    !ZombieAction.isAnyOf(['Roaming'])(chucker.action) ||
    !isWalking(chucker) ||
    !isUnderThreat(chucker, model.player)
  ) {
    return model
  }

  return Option.match(
    pipe(
      model.zombies,
      Array.filter(isShieldable),
      Array.filter(
        zombie =>
          distanceBetween(chucker, zombie) <=
          bodyRadiusOf(chucker) + CHUCKER_RULES.shieldReachPx,
      ),
      Array.sort(byShieldPreference(chucker)),
      Array.head,
    ),
    {
      onNone: () => model,
      onSome: victim =>
        modifyFields(model, {
          zombies: zombies =>
            Array.map(zombies, zombie =>
              pipe(
                zombie,
                setAction(
                  chucker.id,
                  ZombieAction.Shielding({
                    victimId: victim.id,
                    remainingMs: CHUCKER_RULES.shieldMs,
                    aim: angleBetween(chucker, model.player),
                  }),
                ),
                setAction(
                  victim.id,
                  ZombieAction.Shielded({ byId: chucker.id }),
                ),
                yanked =>
                  yanked.id === victim.id
                    ? modifyFields(yanked, {
                        hitRemainingMs: () => ZOMBIE_HIT_PULSE_MS,
                      })
                    : yanked,
              ),
            ),
          frameEvents: Array.append(
            GameEvent.ShieldRaised({ x: chucker.x, y: chucker.y }),
          ),
        }),
    },
  )
}

const isShieldedBy = (chucker: Zombie) => (victim: Zombie) =>
  isWalking(victim) &&
  ZombieAction.isAnyOf(['Shielded'])(victim.action) &&
  victim.action.byId === chucker.id

const dropShield = (model: World, chucker: Zombie): World =>
  modifyFields(model, {
    zombies: Array.map(zombie =>
      zombie.id === chucker.id
        ? modifyFields(zombie, {
            action: () =>
              ZombieAction.Winded({
                remainingMs: CHUCKER_RULES.shieldCooldownMs,
              }),
          })
        : isShieldedBy(chucker)(zombie)
          ? modifyFields(zombie, {
              action: () =>
                ZombieAction.Dazed({
                  remainingMs: CHUCKER_RULES.shieldDropDazedMs,
                  durationMs: CHUCKER_RULES.shieldDropDazedMs,
                }),
            })
          : zombie,
    ),
  })

const turnToward = (aim: number, target: number, maxTurn: number): number => {
  const gap = Math.atan2(Math.sin(target - aim), Math.cos(target - aim))
  return aim + Math.max(-maxTurn, Math.min(maxTurn, gap))
}

// NOTE: he turns slowly to keep the shield toward the player, so a player
// who circles around him can shoot him from the side.
const stepShield = (model: World, chucker: Zombie, deltaMs: number): World => {
  if (!ZombieAction.isAnyOf(['Shielding'])(chucker.action)) {
    return model
  }

  const { victimId, remainingMs, aim } = chucker.action
  const isHeld = Option.isSome(
    Option.filter(findZombie(model.zombies, victimId), isShieldedBy(chucker)),
  )
  if (!isHeld || remainingMs <= deltaMs) {
    return dropShield(model, chucker)
  }

  const turned = turnToward(
    aim,
    angleBetween(chucker, model.player),
    (CHUCKER_RULES.shieldTurnPerSecond * deltaMs) / MS_PER_SECOND,
  )
  return modifyFields(model, {
    zombies: Array.map(
      setAction(
        chucker.id,
        ZombieAction.Shielding({
          victimId,
          remainingMs: remainingMs - deltaMs,
          aim: turned,
        }),
      ),
    ),
  })
}

export const shieldAim = (zombie: Zombie): Option.Option<number> =>
  ZombieAction.isAnyOf(['Shielding'])(zombie.action)
    ? Option.some(zombie.action.aim)
    : Option.none()

// NOTE: a shot that comes at a shielding Big Leaguer from inside his front
// arc hits the zombie he holds instead. Shots from the side or behind reach
// him, and piercing shots and bursts are never blocked.
export const maybeShieldFor = (
  zombie: Zombie,
  direction: Vector,
): Option.Option<number> =>
  ZombieAction.isAnyOf(['Shielding'])(zombie.action) &&
  direction.x * Math.cos(zombie.action.aim) +
    direction.y * Math.sin(zombie.action.aim) <
    -CHUCKER_RULES.shieldArcCos
    ? Option.some(zombie.action.victimId)
    : Option.none()

// FRAME

const isBusy = (zombie: Zombie): boolean =>
  ZombieAction.isAnyOf([
    'Hefting',
    'Carried',
    'Flying',
    'Shielding',
    'Shielded',
  ])(zombie.action)

export const advanceChuckers = (model: World, deltaMs: number): World => {
  const hasWork = Array.some(
    model.zombies,
    zombie => isChucker(zombie) || isBusy(zombie),
  )
  if (!hasWork) {
    return model
  }

  const heaved = Array.reduce(
    Array.filter(model.zombies, isChucker),
    model,
    (current, chucker) =>
      Option.match(findZombie(current.zombies, chucker.id), {
        onNone: () => current,
        onSome: latest =>
          facingNearest(current, latest, fight =>
            stepShield(stepHeft(fight, latest, deltaMs), latest, deltaMs),
          ),
      }),
  )
  const thrownAt = landings(heaved.zombies, deltaMs)
  const flown = modifyFields(heaved, {
    zombies: zombies =>
      pipe(zombies, Array.map(fly(deltaMs)), carried =>
        Array.map(carried, carry(carried)),
      ),
  })
  const landed = Array.reduce(thrownAt, flown, land)
  return Array.reduce(
    Array.filter(landed.zombies, isChucker),
    landed,
    (current, chucker) =>
      Option.match(findZombie(current.zombies, chucker.id), {
        onNone: () => current,
        onSome: latest =>
          facingNearest(current, latest, fight => {
            const shielded = tryShield(fight, latest)
            return Option.match(findZombie(shielded.zombies, latest.id), {
              onNone: () => shielded,
              onSome: after => tryGrab(shielded, after),
            })
          }),
      }),
  )
}
