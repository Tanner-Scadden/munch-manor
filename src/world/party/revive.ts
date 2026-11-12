import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { BULLET_RADIUS, PLAYER_RADIUS } from '../../shared/constants'
import { maxHpOf } from '../heroes/calling'
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
import { bulletDirection, woundPlayer } from '../step/combat'
import {
  ZERO_VECTOR,
  circlesOverlap,
  closestPointOnSegment,
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
  world.modifiers.glass ? 1 : COOP_RULES.reviveHearts

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

// NOTE: after the tick's hurts: a player at zero hearts goes down, and a
// downed one bleeds, or is revived by a teammate who stood still beside
// them for COOP_RULES.reviveMs. Who stood still is read before anyone
// changes, so the order of the seats never matters.
export const advanceParty: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World => {
  if (!isCoop(world)) {
    return world
  }
  return forEachSeat(world, advanceSeat(playersOf(world), deltaMs))
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
