import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  FIXED_STEP_MS,
  MS_PER_SECOND,
  PLAYER_KNOCKBACK_DECAY_PER_SECOND,
  PLAYER_RADIUS,
} from '../../shared/constants'
import { advanceDare } from '../dare/dare'
import {
  advanceLobs,
  fireFridgeWeapon,
  flattenPans,
  resolveShatters,
} from '../fridge/fridgeWeapons'
import { advanceFridge } from '../fridge/leftovers'
import { stabWithKnife } from '../gear/knife'
import { advancePowerUps, playerSpeed } from '../gear/powerups'
import { advanceTraps, clearBrokenTraps, trapBlockers } from '../gear/traps'
import { maybePanOf } from '../gear/weapons'
import { burnHearth } from '../kitchen/gasValve'
import { advanceKitchen, soupSkid } from '../kitchen/kitchen'
import { advancePantry } from '../kitchen/pantry'
import { rollStove } from '../kitchen/stove'
import { type Box, type Level, levelOf } from '../level/arena'
import {
  COOP_RULES,
  facingNearest,
  focusOf,
  forEachSeat,
  isCoop,
  isStanding,
  maybePlayerAt,
  modifySeat,
  playersOf,
  seatStateAt,
} from '../party/party'
import { advanceParty } from '../party/revive'
import type { World } from '../schema/world'
import {
  GameEvent,
  Invulnerability,
  Life,
  Phase,
  type Player,
  type PlayerSlot,
  ShopState,
  type Vector,
  type Zombie,
  idleIntent,
} from '../schema/worldSchema'
import { advancePurchase } from '../shop/purchase'
import { refreshShopPresence } from '../shop/shop'
import { advanceIntensity } from '../waves/pacing'
import { advanceRound, endWhenDefeated } from '../waves/waves'
import { recoverActions } from '../zombies/actions'
import { advanceBossMoves, puddleSlowAt } from '../zombies/boss'
import { advanceChuckers } from '../zombies/chucker'
import { advanceCrawlers, ankleSlowAt, ankleSlowNear } from '../zombies/crawler'
import { advanceFrenzy, payWipedPacks } from '../zombies/frenzy'
import { advanceZombies, recordFootfalls } from '../zombies/zombieMotion'
import { wearOf } from '../zombies/zombies'
import { moveCircle } from './collision'
import { resolveBlasts } from './combat'
import {
  advanceBullets,
  fire,
  shutStallOutsideBreak,
  tickReload,
} from './firing'
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

// INTENT

// NOTE: the player's intent is the step's input. A player at the stall's
// counter does nothing else, whatever they hold.
const gateIntent = (model: World, slot: PlayerSlot): World =>
  ShopState.isAnyOf(['Browsing'])(seatStateAt(model, slot).shop)
    ? modifySeat(model, slot, { intent: () => idleIntent })
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

const faceTowardIntent = (model: World, slot: PlayerSlot): World => {
  const { intent } = seatStateAt(model, slot)
  return modifySeat(model, slot, {
    player: player =>
      modifyFields(player, {
        facing: facing =>
          pipe(
            intent.maybeAim,
            Option.orElse(() => normalize(intent.move)),
            Option.getOrElse(() => facing),
          ),
      }),
  })
}

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

export const shedParts: {
  (after: World): (before: World) => World
  (before: World, after: World): World
} = Function.dual(2, (before: World, after: World): World => {
  const shed = Array.flatMap(
    after.zombies,
    shedEvents(before.zombies, focusOf(after).player),
  )
  return Array.isReadonlyArrayEmpty(shed)
    ? after
    : modifyFields(after, {
        frameEvents: frameEvents => [...frameEvents, ...shed],
      })
})

// INTENSITY

const heartsLostBetween = (before: World, after: World): number =>
  Array.reduce(playersOf(after), 0, (total, { seat, player }) =>
    Option.match(maybePlayerAt(before, seat.slot), {
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
const speedOf = (model: World, slot: PlayerSlot): number => {
  const { boosts, player, seat } = seatStateAt(model, slot)
  return (
    playerSpeed(boosts, player) *
    puddleSlowAt(model.boss, player) *
    (isCoop(model)
      ? ankleSlowNear(model.zombies, player) *
        (isStanding(seat) ? 1 : COOP_RULES.downedCrawlScale)
      : ankleSlowAt(model.zombies))
  )
}

const moveSeat =
  (
    level: Level,
    blockers: ReadonlyArray<Box>,
    seconds: number,
    deltaMs: number,
  ) =>
  (model: World, slot: PlayerSlot): World => {
    const { seat, intent } = seatStateAt(model, slot)
    return Life.isAnyOf(['BledOut'])(seat.life)
      ? model
      : gateIntent(
          modifySeat(model, slot, {
            player: player =>
              movePlayer(
                level,
                player,
                intent.move,
                speedOf(model, slot),
                blockers,
                seconds,
                deltaMs,
              ),
          }),
          slot,
        )
  }

// NOTE: one tick of the seat at `slot` walking and turning from its
// intent, and nothing else: what a co-op client runs to predict its own
// player before the room's answer comes (MULTIPLAYER.md, Phase 4). Hits,
// money, and deaths stay the room's.
const walkSeat = (model: World, slot: PlayerSlot, deltaMs: number): World => {
  const level = levelOf(model)
  return faceTowardIntent(
    moveSeat(
      level,
      trapBlockers(level, model.traps),
      deltaMs / MS_PER_SECOND,
      deltaMs,
    )(model, slot),
    slot,
  )
}

// NOTE: a co-op client's guess at its own seat's next tick from its own
// input (src/world/net/roomWorld.ts, predictOwn): the walk, the reload, and the
// trigger, so its shots' timing, muzzle flash, and ammo show at once. The
// caller keeps only the player; bullets, hits, and money stay the room's.
export const predictSeat: {
  (slot: PlayerSlot, deltaMs: number): (model: World) => World
  (model: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(3, (model: World, slot: PlayerSlot, deltaMs: number): World =>
  armSeat(deltaMs)(walkSeat(model, slot, deltaMs), slot),
)

const withWield = (
  model: World,
  slot: PlayerSlot,
  wield: Player['wield'],
): World =>
  seatStateAt(model, slot).player.wield === wield
    ? model
    : modifySeat(model, slot, {
        player: player => modifyFields(player, { wield: () => wield }),
      })

// NOTE: a co-op player who is down, Downed or BledOut, cannot shoot, but
// the trigger swings whatever is in their melee slot, the knife or the
// Clang Pan (owner, 2026-11-02: "when you are knocked or dead you can use
// your knife, will give the pan more value"). The gun they held stays
// drawn for when they get up: the melee slot is in hand only for the swing.
const swingWhileDown = (
  model: World,
  slot: PlayerSlot,
  deltaMs: number,
): World => {
  const { player } = seatStateAt(model, slot)
  const inHand = withWield(model, slot, 'Melee')
  const swung = Option.match(maybePanOf(player), {
    onNone: () => stabWithKnife(inHand, slot, deltaMs),
    onSome: pan => fireFridgeWeapon(inHand, slot, pan, deltaMs),
  })
  return withWield(swung, slot, player.wield)
}

// NOTE: only a standing player shops, reloads, and fires; one who is down
// swings their melee slot (swingWhileDown).
const armSeat =
  (deltaMs: number) =>
  (model: World, slot: PlayerSlot): World =>
    isStanding(seatStateAt(model, slot).seat)
      ? stabWithKnife(
          fire(
            tickReload(faceTowardIntent(model, slot), slot, deltaMs),
            slot,
            deltaMs,
          ),
          slot,
          deltaMs,
        )
      : isCoop(model)
        ? swingWhileDown(faceTowardIntent(model, slot), slot, deltaMs)
        : faceTowardIntent(model, slot)

// NOTE: only a standing player shops at the stall or holds to buy.
const visitStall =
  (deltaMs: number) =>
  (model: World, slot: PlayerSlot): World =>
    isStanding(seatStateAt(model, slot).seat)
      ? advancePurchase(
          gateIntent(refreshShopPresence(model, slot), slot),
          slot,
          deltaMs,
        )
      : model

const standingSeats = (
  model: World,
  step: (current: World, slot: PlayerSlot) => World,
): World =>
  forEachSeat(model, (current, slot) =>
    isStanding(seatStateAt(current, slot).seat) ? step(current, slot) : current,
  )

const bossAt = (model: World): Vector =>
  Option.getOrElse(
    Array.findFirst(model.zombies, zombie => zombie.kind === 'Boss'),
    (): Vector => focusOf(model).player,
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
  const moved = forEachSeat(
    modifyFields(model, {
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
      frameEvents: () => [],
    }),
    moveSeat(level, blockers, seconds, deltaMs),
  )
  const routed = forEachSeat(moved, visitStall(deltaMs))

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
    cooked => burnHearth(cooked, deltaMs),
    cooked => advanceFridge(cooked, deltaMs),
    contacted => standingSeats(contacted, resolvePlayerContact),
    contacted => recoverActions(contacted, deltaMs),
    recovered => advanceChuckers(recovered, deltaMs),
    heaved => advanceCrawlers(heaved, deltaMs),
    crawled =>
      facingNearest(crawled, bossAt(crawled), (fight, slot) =>
        advanceBossMoves(fight, slot, deltaMs),
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
    advancePantry,
    advanceDare,
    rollStove,
    rounded => shedParts(model, rounded),
    shed => resolveShatters(model, shed),
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
