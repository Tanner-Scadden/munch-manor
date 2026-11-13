import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  BULLET_RADIUS,
  MS_PER_SECOND,
  PLAYER_RADIUS,
} from '../../shared/constants'
import { trapBlockers } from '../gear/traps'
import { maxHpOf } from '../heroes/calling'
import { type Level, levelOf } from '../level/arena'
import type { Box } from '../level/tileGrid'
import { activeModifiersOf } from '../run/dareLadder'
import type { World } from '../schema/world'
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
} from '../schema/worldSchema'
import { moveCircle, resolveCircle } from '../step/collision'
import { bulletDirection, woundPlayer } from '../step/combat'
import {
  ZERO_VECTOR,
  circlesOverlap,
  clampLength,
  closestPointOnSegment,
  distanceBetween,
} from '../step/geometry'
import { fallenLife, saved, sounded } from './medic'
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
} from './party'

// Co-op's life and death (MULTIPLAYER.md, decided row 4): downed players,
// revives, bleeding out, coming back at the break, READY, and friendly fire
// with the Friendly Fire modifier. Single player never reaches any of it.

// DOWNED AND REVIVED

const isStill = ({ intent }: SeatState): boolean =>
  intent.move.x === 0 && intent.move.y === 0

// NOTE: a teammate revives a downed player by standing still beside them:
// standing, here, not moving, within reach.
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
  return modifyFields(world, {
    seats: atSeat(slot, {
      seat: seat =>
        modifyFields(seat, {
          life: () => fallenLife(COOP_RULES.bleedOutMs),
          readiness: () => 'Waiting',
          downs: count => count + 1,
        }),
      player: player =>
        modifyFields(player, {
          hp: () => 0,
          knockback: () => ZERO_VECTOR,
        }),
    }),
    frameEvents: Array.append(
      GameEvent.PlayerDowned({ x: fallen.x, y: fallen.y }),
    ),
  })
}

// NOTE: a Glass run (src/world/run/modifiers.ts) gets up on one heart, as it started.
const reviveHeartsOf = (world: World): number =>
  activeModifiersOf(world).glass ? 1 : COOP_RULES.reviveHearts

const standUp = (world: World, slot: PlayerSlot, hearts: number): World => {
  const { player: risen } = seatStateAt(world, slot)
  return modifyFields(world, {
    seats: atSeat(slot, {
      seat: seat => modifyFields(seat, { life: () => Life.Standing() }),
      player: player =>
        modifyFields(player, {
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

// NOTE: every teammate standing still beside a player when they get up
// counts the revive, for the crew board.
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
    modifyFields(seat, {
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

// KNEELING FOR CPR

// NOTE: a reviver kneels at the downed player's side (owner, 2026-11-12),
// so the CPR pose (src/render/actionPose.ts) reads beside the body rather
// than on top of it. The spot is a body's width to the left or right, the
// nearer side first, then the other, then where they stand. It sits well
// inside the revive's reach, and the slide is a few frames long.
const KNEEL_SIDE_PX = PLAYER_RADIUS * 2 + 1
const KNEEL_SLIDE_PX_PER_SECOND = 90
const OPEN_SPOT_SLACK_PX = 0.01

type Kneel = Readonly<{ slot: PlayerSlot; body: Vector; spot: Vector }>

type Ground = Readonly<{ level: Level; blockers: ReadonlyArray<Box> }>

// NOTE: a spot is open when the level would not push a player standing
// there anywhere: no wall, prop, or trap under it, and inside the bounds.
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

const sidesOf = (body: Vector, mate: Vector): ReadonlyArray<Vector> => {
  const left = { x: body.x - KNEEL_SIDE_PX, y: body.y }
  const right = { x: body.x + KNEEL_SIDE_PX, y: body.y }
  return mate.x < body.x ? [left, right] : [right, left]
}

const isSameSpot = (first: Vector, second: Vector): boolean =>
  first.x === second.x && first.y === second.y

// NOTE: each reviver of one body, in seat order, takes the nearer open
// side no one has taken yet, or stays where they are.
const kneelsAround = (
  ground: Ground,
  body: Vector,
  revivers: ReadonlyArray<SeatState>,
): ReadonlyArray<Kneel> => {
  const kneels: Array<Kneel> = []
  for (const mate of revivers) {
    const spot = pipe(
      sidesOf(body, mate.player),
      Array.findFirst(
        side =>
          isOpenSpot(ground, side) &&
          // NOTE: at most 4 seats kneel, so a few spots to check.
          // oxlint-disable-next-line munch/no-nested-scan
          !Array.some(kneels, kneel => isSameSpot(kneel.spot, side)),
      ),
      Option.getOrElse(() => ({ x: mate.player.x, y: mate.player.y })),
    )
    kneels.push({ slot: mate.seat.slot, body, spot })
  }
  return kneels
}

// NOTE: who kneels where, read off one World before anyone moves, so the
// order of the seats never matters. A reviver beside two bodies kneels by
// the first in seat order.
const kneelsOf = (world: World, ground: Ground): ReadonlyArray<Kneel> => {
  const players = playersOf(world)
  const kneels: Array<Kneel> = []
  const kneeling = new Set<number>()
  for (const downed of players) {
    if (!isDowned(downed.seat)) {
      continue
    }
    // NOTE: at most 4 seats, each downed body checked against the others.
    // oxlint-disable-next-line munch/no-nested-scan
    const revivers = Array.filter(
      players,
      mate =>
        isReviver({ slot: downed.seat.slot, player: downed.player })(mate) &&
        !kneeling.has(mate.seat.slot),
    )
    for (const kneel of kneelsAround(ground, downed.player, revivers)) {
      kneels.push(kneel)
      kneeling.add(kneel.slot)
    }
  }
  return kneels
}

// NOTE: a step toward the spot through the level's collision, kept only
// while it stays in reach, so the slide never ends a revive.
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
    modifyFields(current, {
      seats: atSeat(kneel.slot, {
        player: player => {
          const { x, y } = slideTo(ground, player, kneel, seconds)
          return x === player.x && y === player.y
            ? player
            : modifyFields(player, { x: () => x, y: () => y })
        },
      }),
    }),
  )
}

// NOTE: after the tick's hurts: a player at zero hearts goes down, and a
// downed one bleeds, or is revived by a teammate who stood still beside
// them for COOP_RULES.reviveMs. Who stood still is read before anyone
// changes, so the order of the seats never matters. A reviver whose
// teammate is still down then slides toward their side to kneel.
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

// NOTE: the downed teammate the player at `slot` is picking up, with how
// far the revive has come, 0 to 1, for the client's CPR
// (src/render/actionPose.ts). A read of the rule above, changing nothing.
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

// THE BREAK

// NOTE: downed and bled-out players come back free at the next break
// (decided row 4), with the revive's hearts, and every player's READY
// clears for it. One who stepped out stays out.
export const returnFallen = (world: World): World =>
  isCoop(world)
    ? forEachSeat(world, (current, slot) => {
        const waiting = modifySeatRecord(current, slot, seat =>
          modifyFields(seat, { readiness: () => 'Waiting' }),
        )
        const { seat } = seatStateAt(waiting, slot)
        return isStanding(seat) || isOut(seat)
          ? waiting
          : standUp(waiting, slot, reviveHeartsOf(waiting))
      })
    : world

// NOTE: READY from one player (decided 7, row 12): the break ends once
// everyone who is here and standing has pressed it, or when its clock runs
// out. An away player, or one who stepped out, never holds it up.
export const markReady: {
  (slot: PlayerSlot): (world: World) => World
  (world: World, slot: PlayerSlot): World
} = Function.dual(2, (world: World, slot: PlayerSlot): World =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? modifySeatRecord(world, slot, seat =>
        modifyFields(seat, { readiness: () => 'Ready' }),
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

// FRIENDLY FIRE

// NOTE: off on every difficulty, Nightmare included (decided row 6,
// changed with the owner on 2026-11-01 and again on 2026-11-02). It is the
// Friendly Fire run modifier, which pays extra (isFriendlyFireOn,
// src/world/party/party.ts), the only way teammates hurt each other.
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

// NOTE: with friendly fire on, a teammate's shot that reaches a standing
// player wounds them and stops there. Gnome peas never do. With it off, and
// in single player, shots pass through teammates.
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
            return modifyFields(current, {
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
