import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import {
  BULLET_RADIUS,
  MS_PER_SECOND,
  PLAYER_RADIUS,
} from '#shared/constants.ts'
import { trapBlockers } from '#world/gear/traps.ts'
import { maxHpOf } from '#world/heroes/calling.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import type { Box } from '#world/level/tileGrid.ts'
import { activeModifiersOf } from '#world/run/dareLadder.ts'
import type { World } from '#world/schema/world.ts'
import {
  type Bullet,
  type DownedLife,
  GameEvent,
  Invulnerability,
  Life,
  Phase,
  type PlayerSlot,
  type Seat,
  type SeatState,
  type Vector,
} from '#world/schema/worldSchema.ts'
import { moveCircle, resolveCircle } from '#world/step/collision.ts'
import { bulletDirection, woundPlayer } from '#world/step/combat.ts'
import {
  ZERO_VECTOR,
  circlesOverlap,
  clampLength,
  closestPointOnSegment,
  distanceBetween,
} from '#world/step/geometry.ts'

import { fallenLife, saved, sounded } from './medic.ts'
import {
  COOP_RULES,
  atSeat,
  creditRevive,
  forEachSeat,
  isCoop,
  isDowned,
  isFriendlyFireOn,
  isHere,
  isOut,
  isStanding,
  maybeShooterOf,
  modifySeatRecord,
  playersOf,
  seatStateAt,
} from './party.ts'

const isStill = ({ intent }: SeatState): boolean =>
  intent.move.x === 0 && intent.move.y === 0

const isReviver =
  (downed: Readonly<{ slot: number; player: Vector }>) =>
  (mate: SeatState): boolean =>
    mate.seat.slot !== downed.slot &&
    isStanding(mate.seat) &&
    isHere(mate.seat) &&
    isStill(mate) &&
    circlesOverlap(
      mate.player,
      PLAYER_RADIUS,
      downed.player,
      COOP_RULES.reviveReachPx,
    )

const fall = (world: World, slot: PlayerSlot): World => {
  const { player: fallen } = seatStateAt(world, slot)
  return UiStruct.evolve(world, {
    seats: atSeat(slot, {
      seat: seat =>
        UiStruct.evolve(seat, {
          life: () => fallenLife(COOP_RULES.bleedOutMs),
          readiness: () => 'Waiting',
          downs: count => count + 1,
        }),
      player: player =>
        UiStruct.evolve(player, {
          hp: () => 0,
          knockback: () => ZERO_VECTOR,
        }),
    }),
    frameEvents: Array.append(
      GameEvent.PlayerDowned({ x: fallen.x, y: fallen.y }),
    ),
  })
}

const reviveHeartsOf = (world: World): number =>
  activeModifiersOf(world).glass ? 1 : COOP_RULES.reviveHearts

const standUp = (world: World, slot: PlayerSlot, hearts: number): World => {
  const { player: risen } = seatStateAt(world, slot)
  return UiStruct.evolve(world, {
    seats: atSeat(slot, {
      seat: seat => UiStruct.evolve(seat, { life: () => Life.Standing() }),
      player: player =>
        UiStruct.evolve(player, {
          hp: () => Math.min(hearts, maxHpOf(player)),
          invulnerability: () =>
            Invulnerability.Invulnerable({
              remainingMs: COOP_RULES.revivedInvulnerableMs,
              durationMs: COOP_RULES.revivedInvulnerableMs,
            }),
        }),
    }),
    frameEvents: Array.append(
      GameEvent.PlayerRevived({ x: risen.x, y: risen.y }),
    ),
  })
}

const bleed = (
  world: World,
  slot: PlayerSlot,
  life: DownedLife,
  revivers: ReadonlyArray<SeatState>,
  deltaMs: number,
): World => {
  const reviveMs = Array.isReadonlyArrayNonEmpty(revivers)
    ? life.reviveMs + deltaMs
    : 0
  if (
    Array.isReadonlyArrayNonEmpty(revivers) &&
    reviveMs >= COOP_RULES.reviveMs
  ) {
    return Array.reduce(
      revivers,
      saved(standUp(world, slot, reviveHeartsOf(world)), revivers, life),
      (current, reviver) => creditRevive(current, reviver.seat.slot),
    )
  }
  const bleedMs = life.bleedMs - deltaMs
  const callMs = life.callMs + deltaMs
  return modifySeatRecord(sounded(world, slot, life), slot, seat =>
    UiStruct.evolve(seat, {
      life: () =>
        bleedMs > 0
          ? Life.Downed({ bleedMs, reviveMs, callMs })
          : Life.BledOut(),
    }),
  )
}

const advanceSeat =
  (revivers: ReadonlyArray<SeatState>, deltaMs: number) =>
  (world: World, slot: PlayerSlot): World => {
    const { seat, player } = seatStateAt(world, slot)
    return Life.match(seat.life, {
      Standing: () => (player.hp <= 0 ? fall(world, slot) : world),
      Downed: life =>
        bleed(
          world,
          slot,
          life,
          Array.filter(revivers, isReviver({ slot, player })),
          deltaMs,
        ),
      BledOut: () => world,
      Out: () => world,
    })
  }

const KNEEL_SIDE_PX = PLAYER_RADIUS * 2 + 1
const KNEEL_SLIDE_PX_PER_SECOND = 90
const OPEN_SPOT_SLACK_PX = 0.01

type Kneel = Readonly<{ slot: PlayerSlot; body: Vector; spot: Vector }>

type Ground = Readonly<{ level: Level; blockers: ReadonlyArray<Box> }>

const isOpenSpot = ({ level, blockers }: Ground, spot: Vector): boolean => {
  const { bounds } = level
  return (
    spot.x >= bounds.left + PLAYER_RADIUS &&
    spot.x <= bounds.right - PLAYER_RADIUS &&
    spot.y >= bounds.top + PLAYER_RADIUS &&
    spot.y <= bounds.bottom - PLAYER_RADIUS &&
    distanceBetween(
      resolveCircle(level, spot, PLAYER_RADIUS, blockers, 'Player'),
      spot,
    ) <= OPEN_SPOT_SLACK_PX
  )
}

const isSameSpot = (first: Vector, second: Vector): boolean =>
  first.x === second.x && first.y === second.y

const kneelsAround = (
  ground: Ground,
  body: Vector,
  revivers: ReadonlyArray<SeatState>,
): ReadonlyArray<Kneel> => {
  const left = { x: body.x - KNEEL_SIDE_PX, y: body.y }
  const right = { x: body.x + KNEEL_SIDE_PX, y: body.y }
  let isLeftTaken = false
  let isRightTaken = false
  const isTaken = (side: Vector): boolean =>
    (isLeftTaken && isSameSpot(side, left)) ||
    (isRightTaken && isSameSpot(side, right))
  const kneels: Array<Kneel> = []
  for (const mate of revivers) {
    const [first, second] =
      mate.player.x < body.x ? [left, right] : [right, left]
    const spot =
      isOpenSpot(ground, first) && !isTaken(first)
        ? first
        : isOpenSpot(ground, second) && !isTaken(second)
          ? second
          : { x: mate.player.x, y: mate.player.y }
    kneels.push({ slot: mate.seat.slot, body, spot })
    isLeftTaken = isLeftTaken || isSameSpot(spot, left)
    isRightTaken = isRightTaken || isSameSpot(spot, right)
  }
  return kneels
}

const kneelsOf = (world: World, ground: Ground): ReadonlyArray<Kneel> => {
  const players = playersOf(world)
  const kneels: Array<Kneel> = []
  const kneeling = new Set<number>()
  for (const downed of players) {
    if (!isDowned(downed.seat)) {
      continue
    }
    const isDownedReviver = isReviver({
      slot: downed.seat.slot,
      player: downed.player,
    })
    const revivers: Array<SeatState> = []
    for (const mate of players) {
      if (isDownedReviver(mate) && !kneeling.has(mate.seat.slot)) {
        revivers.push(mate)
      }
    }
    for (const kneel of kneelsAround(ground, downed.player, revivers)) {
      kneels.push(kneel)
      kneeling.add(kneel.slot)
    }
  }
  return kneels
}

const slideTo = (
  ground: Ground,
  from: Vector,
  { body, spot }: Kneel,
  seconds: number,
): Vector => {
  const step = clampLength(
    { x: spot.x - from.x, y: spot.y - from.y },
    KNEEL_SLIDE_PX_PER_SECOND * seconds,
  )
  if (step.x === 0 && step.y === 0) {
    return from
  }
  const moved = moveCircle(
    ground.level,
    from,
    step,
    PLAYER_RADIUS,
    ground.blockers,
    'Player',
  )
  return circlesOverlap(moved, PLAYER_RADIUS, body, COOP_RULES.reviveReachPx)
    ? moved
    : from
}

const kneelRevivers = (world: World, deltaMs: number): World => {
  const level = levelOf(world)
  const ground: Ground = { level, blockers: trapBlockers(level, world.traps) }
  const seconds = deltaMs / MS_PER_SECOND
  return Array.reduce(kneelsOf(world, ground), world, (current, kneel) =>
    UiStruct.evolve(current, {
      seats: atSeat(kneel.slot, {
        player: player => {
          const { x, y } = slideTo(ground, player, kneel, seconds)
          return x === player.x && y === player.y
            ? player
            : UiStruct.evolve(player, { x: () => x, y: () => y })
        },
      }),
    }),
  )
}

export const advanceParty: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World => {
  if (!isCoop(world)) {
    return world
  }
  return kneelRevivers(
    forEachSeat(world, advanceSeat(playersOf(world), deltaMs)),
    deltaMs,
  )
})

export const maybeRevivingOf: {
  (
    slot: PlayerSlot,
  ): (
    world: World,
  ) => Option.Option<Readonly<{ target: Vector; share: number }>>
  (
    world: World,
    slot: PlayerSlot,
  ): Option.Option<Readonly<{ target: Vector; share: number }>>
} = Function.dual(
  2,
  (
    world: World,
    slot: PlayerSlot,
  ): Option.Option<Readonly<{ target: Vector; share: number }>> => {
    if (!isCoop(world)) {
      return Option.none()
    }
    const reviver = seatStateAt(world, slot)
    return Array.findFirst(playersOf(world), ({ seat, player }) =>
      Life.isAnyOf(['Downed'])(seat.life) &&
      isReviver({ slot: seat.slot, player })(reviver)
        ? Option.some({
            target: { x: player.x, y: player.y },
            share: Math.min(1, seat.life.reviveMs / COOP_RULES.reviveMs),
          })
        : Option.none(),
    )
  },
)

export const returnFallen = (world: World): World =>
  isCoop(world)
    ? forEachSeat(world, (current, slot) => {
        const waiting = modifySeatRecord(current, slot, seat =>
          UiStruct.evolve(seat, { readiness: () => 'Waiting' }),
        )
        const { seat } = seatStateAt(waiting, slot)
        return isStanding(seat) || isOut(seat)
          ? waiting
          : standUp(waiting, slot, reviveHeartsOf(waiting))
      })
    : world

export const markReady: {
  (slot: PlayerSlot): (world: World) => World
  (world: World, slot: PlayerSlot): World
} = Function.dual(2, (world: World, slot: PlayerSlot): World =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? modifySeatRecord(world, slot, seat =>
        UiStruct.evolve(seat, { readiness: () => 'Ready' }),
      )
    : world,
)

const isHoldingBreak = (seat: Seat): boolean =>
  isHere(seat) &&
  !isDowned(seat) &&
  !isOut(seat) &&
  seat.readiness === 'Waiting'

export const isEveryoneReady = (world: World): boolean =>
  isCoop(world) &&
  !Array.some(playersOf(world), ({ seat }) => isHoldingBreak(seat))

const isTeammateShot =
  (slot: number) =>
  (bullet: Bullet): boolean =>
    Option.exists(maybeShooterOf(bullet), shooter => shooter !== slot)

const sweepHits =
  (
    target: Vector,
    seconds: number,
    from: (bullet: Bullet) => Vector,
    firstFreshId: number,
  ) =>
  (bullet: Bullet): boolean => {
    const start =
      bullet.id >= firstFreshId
        ? from(bullet)
        : {
            x: bullet.x - bullet.velocityX * seconds,
            y: bullet.y - bullet.velocityY * seconds,
          }
    const point = closestPointOnSegment(target, start, bullet)
    return circlesOverlap(point, BULLET_RADIUS, target, PLAYER_RADIUS)
  }

export const resolveFriendlyFire: {
  (
    seconds: number,
    from: (bullet: Bullet) => Vector,
    firstFreshId: number,
  ): (world: World) => World
  (
    world: World,
    seconds: number,
    from: (bullet: Bullet) => Vector,
    firstFreshId: number,
  ): World
} = Function.dual(
  4,
  (
    world: World,
    seconds: number,
    from: (bullet: Bullet) => Vector,
    firstFreshId: number,
  ): World => {
    if (!isFriendlyFireOn(world)) {
      return world
    }
    return forEachSeat(world, (current, slot) => {
      const { seat, player: target } = seatStateAt(current, slot)
      if (
        !isStanding(seat) ||
        Invulnerability.isAnyOf(['Invulnerable'])(target.invulnerability)
      ) {
        return current
      }
      return pipe(
        current.bullets,
        Array.findFirst(
          bullet =>
            bullet.weapon !== 'Peashooter' &&
            isTeammateShot(slot)(bullet) &&
            sweepHits(target, seconds, from, firstFreshId)(bullet),
        ),
        Option.match({
          onNone: () => current,
          onSome: bullet => {
            const direction = bulletDirection(bullet)
            return UiStruct.evolve(current, {
              seats: atSeat(slot, {
                player: player =>
                  woundPlayer(player, COOP_RULES.friendlyFireDamage, direction),
              }),
              bullets: Array.filter(({ id }) => id !== bullet.id),
              frameEvents: Array.append(
                GameEvent.FriendlyFire({
                  x: target.x,
                  y: target.y,
                  direction,
                }),
              ),
            })
          },
        }),
      )
    })
  },
)
