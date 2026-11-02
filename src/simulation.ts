import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { recoverActions } from './actions'
import { type Box, type Level, levelOf, moveCircle } from './arena'
import { advanceBossMoves, puddleSlowAt } from './boss'
import { advanceChuckers } from './chucker'
import { resolveBlasts } from './combat'
import {
  FIXED_STEP_MS,
  MS_PER_SECOND,
  PLAYER_KNOCKBACK_DECAY_PER_SECOND,
  PLAYER_RADIUS,
} from './constants'
import { advanceCrawlers, ankleSlowAt, ankleSlowNear } from './crawler'
import {
  advanceBullets,
  fire,
  shutStallOutsideBreak,
  tickReload,
} from './firing'
import { advanceFrenzy, payWipedPacks } from './frenzy'
import { advanceLobs, flattenPans, shatterEvents } from './fridgeWeapons'
import {
  OUTWARD,
  addVectors,
  clamp,
  countDown,
  decayKnockback,
  directionBetween,
  normalize,
  scaleVector,
} from './geometry'
import { stopForHits, thawTick } from './hitStop'
import { resolveBulletHits, resolvePlayerContact } from './hits'
import { advanceKitchen, soupSkid } from './kitchen'
import { stabWithKnife } from './knife'
import { advanceFridge } from './leftovers'
import { advanceIntensity } from './pacing'
import {
  COOP_RULES,
  facingNearest,
  forEachSeat,
  isCoop,
  isStanding,
  leadSeatOf,
  maybePlayerAt,
  playersOf,
  targetsOf,
} from './party'
import { refreshFlowFieldToward } from './pathing'
import { advancePowerUps, playerSpeed } from './powerups'
import { advancePurchase } from './purchase'
import { advanceParty } from './revive'
import { refreshShopPresence } from './shop'
import { advanceTraps, clearBrokenTraps, tollsOf, trapBlockers } from './traps'
import { advanceRound, endWhenDefeated } from './waves'
import type { World } from './world'
import {
  GameEvent,
  Invulnerability,
  Life,
  Phase,
  type Player,
  ShopState,
  type Vector,
  type Zombie,
  idleIntent,
} from './worldSchema'
import { advanceZombies, recordFootfalls } from './zombieMotion'
import { wearOf } from './zombies'

// INTENT

// NOTE: the player's intent is the step's input. A player at the stall's
// counter does nothing else, whatever they hold.
const gateIntent = (model: World): World =>
  ShopState.isAnyOf(['Browsing'])(model.shop)
    ? modifyFields(model, { intent: () => idleIntent })
    : model

// PLAYER

const tickInvulnerability = (
  invulnerability: Invulnerability,
  deltaMs: number,
): Invulnerability =>
  Invulnerability.match(invulnerability, {
    Vulnerable: () => invulnerability,
    Invulnerable: ({ remainingMs, durationMs }) =>
      remainingMs > deltaMs
        ? Invulnerability.Invulnerable({
            remainingMs: remainingMs - deltaMs,
            durationMs,
          })
        : Invulnerability.Vulnerable(),
  })

const movePlayer = (
  level: Level,
  player: Player,
  move: Vector,
  speed: number,
  blockers: ReadonlyArray<Box>,
  seconds: number,
  deltaMs: number,
): Player => {
  const velocity = addVectors(scaleVector(move, speed), player.knockback)
  const moved = moveCircle(
    level,
    player,
    scaleVector(velocity, seconds),
    PLAYER_RADIUS,
    blockers,
    'Player',
  )
  const { bounds } = level
  return modifyFields(player, {
    x: () =>
      clamp(moved.x, bounds.left + PLAYER_RADIUS, bounds.right - PLAYER_RADIUS),
    y: () =>
      clamp(moved.y, bounds.top + PLAYER_RADIUS, bounds.bottom - PLAYER_RADIUS),
    knockback: knockback =>
      addVectors(
        decayKnockback(knockback, PLAYER_KNOCKBACK_DECAY_PER_SECOND, seconds),
        soupSkid(level, player, move, seconds),
      ),
    invulnerability: invulnerability =>
      tickInvulnerability(invulnerability, deltaMs),
    recoilRemainingMs: remainingMs => countDown(remainingMs, deltaMs),
  })
}

const faceTowardIntent = (model: World): World =>
  modifyFields(model, {
    player: player =>
      modifyFields(player, {
        facing: facing =>
          pipe(
            model.intent.maybeAim,
            Option.orElse(() => normalize(model.intent.move)),
            Option.getOrElse(() => facing),
          ),
      }),
  })

// WEAR

const shedDirection = (zombie: Zombie, player: Player): Vector =>
  pipe(
    normalize(zombie.knockback),
    Option.orElse(() => directionBetween(player, zombie)),
    Option.getOrElse(() => OUTWARD),
  )

// NOTE: the zombies keep their order from one frame to the next (the dead
// leave, new ones join at the end), so each one's wear a frame ago is found by
// walking `before` forward from the last match, not by searching all of it. A
// zombie the walk misses (an order that changed) falls back to a full search.
const wearBefore = (before: ReadonlyArray<Zombie>) => {
  let cursor = 0
  return (zombie: Zombie): Option.Option<number> => {
    let at = cursor
    while (at < before.length && before[at]?.id !== zombie.id) {
      at++
    }
    const walked = before[at]
    if (walked !== undefined) {
      cursor = at + 1
      return Option.some(wearOf(walked))
    }

    return Option.map(
      Array.findFirst(before, ({ id }) => id === zombie.id),
      wearOf,
    )
  }
}

const shedEvents = (before: ReadonlyArray<Zombie>, player: Player) => {
  const wearBeforeOf = wearBefore(before)
  return (zombie: Zombie): ReadonlyArray<GameEvent> => {
    const worn = wearOf(zombie)
    if (zombie.hp <= 0 || worn === 0) {
      return []
    }

    const wasWorn = Option.getOrElse(wearBeforeOf(zombie), () => worn)
    if (worn <= wasWorn) {
      return []
    }

    const direction = shedDirection(zombie, player)
    return Array.map(Array.range(wasWorn, worn - 1), stage =>
      GameEvent.PartShed({
        x: zombie.x,
        y: zombie.y,
        direction,
        kind: zombie.kind,
        stage,
      }),
    )
  }
}

export const shedParts = (before: World, after: World): World => {
  const shed = Array.flatMap(
    after.zombies,
    shedEvents(before.zombies, after.player),
  )
  return Array.isReadonlyArrayEmpty(shed)
    ? after
    : modifyFields(after, {
        frameEvents: frameEvents => [...frameEvents, ...shed],
      })
}

// INTENSITY

const heartsLostBetween = (before: World, after: World): number =>
  Array.reduce(playersOf(after), 0, (total, { slot, player }) =>
    Option.match(maybePlayerAt(before, slot), {
      onNone: () => total,
      onSome: was => total + Math.max(0, was.player.hp - player.hp),
    }),
  )

const feelIntensity = (before: World, after: World, deltaMs: number): World =>
  modifyFields(after, {
    intensity: intensity =>
      advanceIntensity(
        intensity,
        heartsLostBetween(before, after),
        after.zombies,
        Array.map(playersOf(after), ({ player }) => player),
        deltaMs,
      ),
  })

// FRAME

// NOTE: a downed player crawls (decided row 4), and one an Ankle Biter
// clings to drags their feet. In single player any clinging Ankle Biter is
// on the one player's ankles.
const speedOf = (model: World): number =>
  playerSpeed(model.boosts, model.player) *
  puddleSlowAt(model.boss, model.player) *
  (isCoop(model)
    ? ankleSlowNear(model.zombies, model.player) *
      (isStanding(leadSeatOf(model)) ? 1 : COOP_RULES.downedCrawlScale)
    : ankleSlowAt(model.zombies))

const moveSeat =
  (
    level: Level,
    blockers: ReadonlyArray<Box>,
    seconds: number,
    deltaMs: number,
  ) =>
  (model: World): World =>
    Life.isAnyOf(['BledOut'])(leadSeatOf(model).life)
      ? model
      : gateIntent(
          modifyFields(model, {
            player: player =>
              movePlayer(
                level,
                player,
                model.intent.move,
                speedOf(model),
                blockers,
                seconds,
                deltaMs,
              ),
          }),
        )

// NOTE: one tick of the seat in the World's per-player fields walking and
// turning from its intent, and nothing else: what a co-op client runs to
// predict its own player before the room's answer comes (MULTIPLAYER.md,
// Phase 4). Hits, money, and deaths stay the room's.
const walkLeadSeat = (model: World, deltaMs: number): World => {
  const level = levelOf(model)
  return faceTowardIntent(
    moveSeat(
      level,
      trapBlockers(level, model.traps),
      deltaMs / MS_PER_SECOND,
      deltaMs,
    )(model),
  )
}

// NOTE: a co-op client's guess at its own seat's next tick from its own
// input (src/roomWorld.ts, predictOwn): the walk, the reload, and the
// trigger, so its shots' timing, muzzle flash, and ammo show at once. The
// caller keeps only the player; bullets, hits, and money stay the room's.
export const predictLeadSeat = (model: World, deltaMs: number): World =>
  armSeat(deltaMs)(walkLeadSeat(model, deltaMs))

// NOTE: only a standing player shops, reloads, fires, and stabs.
const armSeat =
  (deltaMs: number) =>
  (model: World): World =>
    isStanding(leadSeatOf(model))
      ? stabWithKnife(
          fire(tickReload(faceTowardIntent(model), deltaMs), deltaMs),
          deltaMs,
        )
      : faceTowardIntent(model)

// NOTE: only a standing player shops at the stall or holds to buy.
const visitStall =
  (deltaMs: number) =>
  (model: World): World =>
    isStanding(leadSeatOf(model))
      ? advancePurchase(gateIntent(refreshShopPresence(model)), deltaMs)
      : model

const standingSeats = (
  model: World,
  step: (seatWorld: World) => World,
): World =>
  forEachSeat(model, seatWorld =>
    isStanding(leadSeatOf(seatWorld)) ? step(seatWorld) : seatWorld,
  )

const bossAt = (model: World): Vector =>
  Option.getOrElse(
    Array.findFirst(model.zombies, zombie => zombie.kind === 'Boss'),
    (): Vector => model.player,
  )

// NOTE: when a wave ends and its break begins, Rattles bangs every
// player's Clang Pan flat.
const flattenAtBreak = (before: World, after: World): World =>
  Phase.isAnyOf(['Wave'])(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase)
    ? forEachSeat(after, flattenPans)
    : after

const advanceWorld = (model: World, deltaMs: number): World => {
  const seconds = deltaMs / MS_PER_SECOND

  const level = levelOf(model)
  const blockers = trapBlockers(level, model.traps)
  const tolls = tollsOf(level, model.traps)
  const moved = forEachSeat(
    modifyFields(model, {
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
      frameEvents: () => [],
    }),
    moveSeat(level, blockers, seconds, deltaMs),
  )
  const targets = targetsOf(moved)
  const routed = forEachSeat(
    modifyFields(moved, {
      flowField: flowField =>
        refreshFlowFieldToward(level, flowField, targets, 'Narrow', tolls),
      wideFlowField: flowField =>
        refreshFlowFieldToward(level, flowField, targets, 'Wide', tolls),
    }),
    visitStall(deltaMs),
  )

  const armed = forEachSeat(routed, armSeat(deltaMs))

  const advanced = modifyFields(advanceBullets(armed, seconds, deltaMs), {
    zombies: () => advanceZombies(armed, seconds, deltaMs),
  })

  const fought = pipe(
    recordFootfalls(advanced, deltaMs),
    footed => resolveBulletHits(footed, seconds, routed.nextEntityId),
    struck => advanceLobs(struck, deltaMs),
    trapped => advanceTraps(trapped, seconds, deltaMs),
    trapped => advanceKitchen(armed, trapped, deltaMs),
    cooked => advanceFridge(cooked, deltaMs),
    contacted => standingSeats(contacted, resolvePlayerContact),
    contacted => recoverActions(contacted, deltaMs),
    recovered => advanceChuckers(recovered, deltaMs),
    heaved => advanceCrawlers(heaved, deltaMs),
    crawled =>
      facingNearest(crawled, bossAt(crawled), fight =>
        advanceBossMoves(fight, deltaMs),
      ),
    resolveBlasts,
  )
  return pipe(
    advanceFrenzy(fought, deltaMs),
    frenzied => payWipedPacks(model, frenzied),
    clearBrokenTraps,
    blasted => feelIntensity(model, blasted, deltaMs),
    felt => advancePowerUps(felt, advanceRound(felt, deltaMs), deltaMs),
    rounded => flattenAtBreak(model, rounded),
    rounded => shedParts(model, rounded),
    shed => shatterEvents(model, shed),
    downed => advanceParty(downed, deltaMs),
    endWhenDefeated,
    shutStallOutsideBreak,
  )
}

// NOTE: one 60 Hz tick of the world from the player's intent: hit-stop
// decides whether the world steps, then the tick's events decide the next
// hit-stop.
export type Tick = Readonly<{ world: World; worldMs: number }>

export const advanceTick = (world: World): Tick => {
  const thaw = thawTick(world.hitStop, FIXED_STEP_MS)
  const thawed = modifyFields(world, {
    hitStop: () => thaw.hitStop,
    frameEvents: () => [],
  })
  const stepped = thaw.worldMs > 0 ? advanceWorld(thawed, thaw.worldMs) : thawed
  return {
    world: isCoop(stepped) ? stepped : stopForHits(stepped, thaw.worldMs),
    worldMs: thaw.worldMs,
  }
}
