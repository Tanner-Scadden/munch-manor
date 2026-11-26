import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  FIXED_STEP_MS,
  MS_PER_SECOND,
  PLAYER_KNOCKBACK_DECAY_PER_SECOND,
  PLAYER_RADIUS,
} from '#shared/constants.ts'
import { emptied, sameIfUnchanged } from '#shared/sameList.ts'
import { rollBarrel } from '#world/cellar/barrels.ts'
import { advanceDare, isWorkingFind } from '#world/dare/dare.ts'
import { advanceFinale } from '#world/dare/finale.ts'
import { dropChandelier, rehangAtBreak } from '#world/dining/chandelier.ts'
import { advanceCases } from '#world/feats/cases.ts'
import { tallyFeats } from '#world/feats/feats.ts'
import {
  advanceLobs,
  fireFridgeWeapon,
  flattenPans,
  resolveShatters,
} from '#world/fridge/fridgeWeapons.ts'
import { advanceFridge } from '#world/fridge/leftovers.ts'
import { advanceCrates } from '#world/gear/crates.ts'
import { stabWithKnife } from '#world/gear/knife.ts'
import { advancePowerUps, playerSpeed } from '#world/gear/powerups.ts'
import {
  advanceMending,
  advanceTraps,
  clearBrokenTraps,
  trapBlockers,
} from '#world/gear/traps.ts'
import { maybePanOf } from '#world/gear/weapons.ts'
import { dropKeys } from '#world/keys/keys.ts'
import { burnHearth } from '#world/kitchen/gasValve.ts'
import { advanceKitchen, soupSkid } from '#world/kitchen/kitchen.ts'
import { advancePantry } from '#world/kitchen/pantry.ts'
import { rollStove } from '#world/kitchen/stove.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { wadePaceAt } from '#world/level/leaks.ts'
import type { Box } from '#world/level/tileGrid.ts'
import { swingShelf } from '#world/library/secretShelf.ts'
import { shelveHeaps } from '#world/library/stacks.ts'
import {
  COOP_RULES,
  facingNearest,
  focusOf,
  forEachSeat,
  isCoop,
  isOut,
  isStanding,
  maybePlayerAt,
  modifySeat,
  playersOf,
  seatStateAt,
} from '#world/party/party.ts'
import { advanceParty } from '#world/party/revive.ts'
import { advanceArrival, isArriving } from '#world/run/arrival.ts'
import { advanceTutorialKey } from '#world/run/tutorialRules.ts'
import type { World } from '#world/schema/world.ts'
import {
  GameEvent,
  Invulnerability,
  Life,
  Phase,
  type Player,
  type PlayerSlot,
  type Vector,
  type Zombie,
} from '#world/schema/worldSchema.ts'
import { advancePurchase } from '#world/shop/purchase.ts'
import { advanceStations, isWorkingStation } from '#world/stations/stations.ts'
import { advanceIntensity } from '#world/waves/pacing.ts'
import { advanceRound, endWhenDefeated } from '#world/waves/waves.ts'
import { recoverActions } from '#world/zombies/actions.ts'
import { advanceBossMoves } from '#world/zombies/boss.ts'
import { puddleSlowAt } from '#world/zombies/bossFight.ts'
import { advanceChuckers } from '#world/zombies/chucker.ts'
import {
  advanceCrawlers,
  ankleSlowAt,
  ankleSlowNear,
} from '#world/zombies/crawler.ts'
import { advanceFrenzy, keyWipedPacks } from '#world/zombies/frenzy.ts'
import { advanceLastZombie } from '#world/zombies/lastZombie.ts'
import { advanceZombies, recordFootfalls } from '#world/zombies/zombieMotion.ts'
import { wearOf } from '#world/zombies/zombies.ts'

import { moveCircle } from './collision.ts'
import { resolveBlasts } from './combat.ts'
import { bulletFlightOf, fire, tickReload } from './firing.ts'
import {
  OUTWARD,
  addVectors,
  clamp,
  countDown,
  decayKnockback,
  directionBetween,
  normalize,
  scaleVector,
} from './geometry.ts'
import { stopForHits, thawTick } from './hitStop.ts'
import { resolveBulletHits, resolvePlayerContact } from './hits.ts'

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
  return UiStruct.evolve(player, {
    x: () =>
      clamp(moved.x, bounds.left + PLAYER_RADIUS, bounds.right - PLAYER_RADIUS),
    y: () =>
      clamp(moved.y, bounds.top + PLAYER_RADIUS, bounds.bottom - PLAYER_RADIUS),
    knockback: knockback => {
      const next = addVectors(
        decayKnockback(knockback, PLAYER_KNOCKBACK_DECAY_PER_SECOND, seconds),
        soupSkid(level, player, move, seconds),
      )
      return Object.is(next.x, knockback.x) && Object.is(next.y, knockback.y)
        ? knockback
        : next
    },
    invulnerability: invulnerability =>
      tickInvulnerability(invulnerability, deltaMs),
    recoilRemainingMs: remainingMs => countDown(remainingMs, deltaMs),
  })
}

const faceTowardIntent = (model: World, slot: PlayerSlot): World => {
  const { intent } = seatStateAt(model, slot)
  return modifySeat(model, slot, {
    player: player =>
      UiStruct.evolve(player, {
        facing: facing =>
          pipe(
            intent.maybeAim,
            Option.orElse(() => normalize(intent.move)),
            Option.getOrElse(() => facing),
          ),
      }),
  })
}

const shedDirection = (zombie: Zombie, player: Player): Vector =>
  pipe(
    normalize(zombie.knockback),
    Option.orElse(() => directionBetween(player, zombie)),
    Option.getOrElse(() => OUTWARD),
  )

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
    : UiStruct.evolve(after, {
        frameEvents: frameEvents => [...frameEvents, ...shed],
      })
})

const heartsLostBetween = (before: World, after: World): number =>
  Array.reduce(playersOf(after), 0, (total, { seat, player }) =>
    Option.match(maybePlayerAt(before, seat.slot), {
      onNone: () => total,
      onSome: was => total + Math.max(0, was.player.hp - player.hp),
    }),
  )

const feelIntensity = (before: World, after: World, deltaMs: number): World =>
  UiStruct.evolve(after, {
    intensity: intensity =>
      advanceIntensity(
        intensity,
        heartsLostBetween(before, after),
        after.zombies,
        Array.map(playersOf(after), ({ player }) => player),
        deltaMs,
      ),
  })

const speedOf = (level: Level, model: World, slot: PlayerSlot): number => {
  const { boosts, player, seat } = seatStateAt(model, slot)
  return (
    playerSpeed(boosts, player) *
    puddleSlowAt(model.boss, player) *
    wadePaceAt(level, player) *
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
    return Life.isAnyOf(['BledOut', 'Out'])(seat.life)
      ? model
      : modifySeat(model, slot, {
          player: player =>
            movePlayer(
              level,
              player,
              intent.move,
              speedOf(level, model, slot),
              blockers,
              seconds,
              deltaMs,
            ),
        })
  }

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
        player: player => UiStruct.evolve(player, { wield: () => wield }),
      })

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

const armSeat =
  (deltaMs: number) =>
  (model: World, slot: PlayerSlot): World =>
    isStanding(seatStateAt(model, slot).seat) &&
    (isWorkingStation(model, slot) || isWorkingFind(model, slot))
      ? tickReload(faceTowardIntent(model, slot), slot, deltaMs)
      : isStanding(seatStateAt(model, slot).seat)
        ? stabWithKnife(
            fire(
              tickReload(faceTowardIntent(model, slot), slot, deltaMs),
              slot,
              deltaMs,
            ),
            slot,
            deltaMs,
          )
        : isCoop(model) && !isOut(seatStateAt(model, slot).seat)
          ? swingWhileDown(faceTowardIntent(model, slot), slot, deltaMs)
          : faceTowardIntent(model, slot)

const holdToBuy =
  (deltaMs: number) =>
  (model: World, slot: PlayerSlot): World =>
    isStanding(seatStateAt(model, slot).seat)
      ? advancePurchase(model, slot, deltaMs)
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
    UiStruct.evolve(model, {
      elapsedMs: elapsedMs => elapsedMs + deltaMs,
      frameEvents: emptied,
    }),
    moveSeat(level, blockers, seconds, deltaMs),
  )
  const routed = forEachSeat(moved, holdToBuy(deltaMs))

  const armed = forEachSeat(advanceStations(routed, deltaMs), armSeat(deltaMs))

  const advanced = UiStruct.evolve(armed, {
    ...bulletFlightOf(armed, seconds, deltaMs),
    zombies: zombies =>
      sameIfUnchanged(zombies, advanceZombies(armed, seconds, deltaMs)),
  })

  const fought = pipe(
    recordFootfalls(advanced, deltaMs),
    footed => resolveBulletHits(footed, seconds, routed.nextEntityId),
    dropChandelier,
    swingShelf,
    shelved => rollBarrel(shelveHeaps(shelved), deltaMs),
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
    frenzied => advanceLastZombie(keyWipedPacks(model, frenzied), deltaMs),
    clearBrokenTraps,
    blasted => feelIntensity(model, blasted, deltaMs),
    felt => advancePowerUps(felt, advanceRound(felt, deltaMs), deltaMs),
    rounded => flattenAtBreak(model, rounded),
    rounded => rehangAtBreak(model, rounded),
    advancePantry,
    advanceCrates,
    advanceTutorialKey,
    crated => advanceMending(crated, deltaMs),
    crated => advanceDare(crated, deltaMs),
    dared => advanceFinale(dared, deltaMs),
    rollStove,
    rounded => shedParts(model, rounded),
    shed => resolveShatters(model, shed),
    downed => advanceParty(downed, deltaMs),
    endWhenDefeated,
    dropKeys,
    ended => advanceCases(tallyFeats(model, ended)),
  )
}

export type Tick = Readonly<{ world: World; worldMs: number }>

export const advanceTick = (world: World): Tick => {
  if (isArriving(world.phase)) {
    return {
      world: advanceArrival(
        UiStruct.evolve(world, { frameEvents: () => [] }),
        FIXED_STEP_MS,
      ),
      worldMs: FIXED_STEP_MS,
    }
  }
  const thaw = thawTick(world.hitStop, FIXED_STEP_MS)
  const thawed = UiStruct.evolve(world, {
    hitStop: () => thaw.hitStop,
    frameEvents: emptied,
  })
  const stepped = thaw.worldMs > 0 ? advanceWorld(thawed, thaw.worldMs) : thawed
  return {
    world: isCoop(stepped) ? stepped : stopForHits(stepped, thaw.worldMs),
    worldMs: thaw.worldMs,
  }
}
