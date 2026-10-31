import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { bulletDirection, woundPlayer } from './combat'
import { BULLET_RADIUS, PLAYER_RADIUS } from './constants'
import { ZERO_VECTOR, circlesOverlap, closestPointOnSegment } from './geometry'
import {
  COOP_RULES,
  type SeatedPlayer,
  creditRevive,
  forEachSeat,
  isCoop,
  isDowned,
  isHere,
  isStanding,
  leadSeatOf,
  maybeShooterOf,
  modifyLeadSeat,
  playersOf,
} from './party'
import type { World } from './world'
import {
  type Bullet,
  GameEvent,
  Invulnerability,
  Life,
  Phase,
  type Seat,
  type Vector,
} from './worldSchema'

// Co-op's life and death (MULTIPLAYER.md, decided row 4): downed players,
// revives, bleeding out, coming back at the break, READY, and friendly fire
// on Nightmare. Single player never reaches any of it.

// DOWNED AND REVIVED

const isStill = ({ intent }: SeatedPlayer): boolean =>
  intent.move.x === 0 && intent.move.y === 0

// NOTE: a teammate revives a downed player by standing still beside them:
// standing, here, not moving, within reach.
const isReviver =
  (downed: Readonly<{ slot: number; player: Vector }>) =>
  (mate: SeatedPlayer): boolean =>
    mate.slot !== downed.slot &&
    isStanding(mate.seat) &&
    isHere(mate.seat) &&
    isStill(mate) &&
    circlesOverlap(
      mate.player,
      PLAYER_RADIUS,
      downed.player,
      COOP_RULES.reviveReachPx,
    )

const fall = (world: World): World =>
  modifyFields(
    modifyLeadSeat(world, seat =>
      modifyFields(seat, {
        life: () =>
          Life.Downed({ bleedMs: COOP_RULES.bleedOutMs, reviveMs: 0 }),
        readiness: () => 'Waiting',
        downs: count => count + 1,
      }),
    ),
    {
      player: player =>
        modifyFields(player, {
          hp: () => 0,
          knockback: () => ZERO_VECTOR,
        }),
      frameEvents: Array.append(
        GameEvent.PlayerDowned({ x: world.player.x, y: world.player.y }),
      ),
    },
  )

const standUp = (world: World, hearts: number): World =>
  modifyFields(
    modifyLeadSeat(world, seat =>
      modifyFields(seat, { life: () => Life.Standing() }),
    ),
    {
      player: player =>
        modifyFields(player, {
          hp: () => hearts,
          invulnerability: () =>
            Invulnerability.Invulnerable({
              remainingMs: COOP_RULES.revivedInvulnerableMs,
              durationMs: COOP_RULES.revivedInvulnerableMs,
            }),
        }),
      frameEvents: Array.append(
        GameEvent.PlayerRevived({ x: world.player.x, y: world.player.y }),
      ),
    },
  )

// NOTE: every teammate standing still beside a player when they get up
// counts the revive, for the crew board.
const bleed = (
  world: World,
  life: Readonly<{ bleedMs: number; reviveMs: number }>,
  revivers: ReadonlyArray<SeatedPlayer>,
  deltaMs: number,
): World => {
  const reviveMs = Array.isReadonlyArrayNonEmpty(revivers)
    ? life.reviveMs + deltaMs
    : 0
  if (reviveMs >= COOP_RULES.reviveMs) {
    return Array.reduce(
      revivers,
      standUp(world, COOP_RULES.reviveHearts),
      (current, reviver) => creditRevive(current, reviver.slot),
    )
  }
  const bleedMs = life.bleedMs - deltaMs
  return modifyLeadSeat(world, seat =>
    modifyFields(seat, {
      life: () =>
        bleedMs > 0 ? Life.Downed({ bleedMs, reviveMs }) : Life.BledOut(),
    }),
  )
}

const advanceSeat =
  (revivers: ReadonlyArray<SeatedPlayer>, deltaMs: number) =>
  (world: World): World => {
    const seat = leadSeatOf(world)
    return Life.match(seat.life, {
      Standing: () => (world.player.hp <= 0 ? fall(world) : world),
      Downed: life =>
        bleed(
          world,
          life,
          Array.filter(
            revivers,
            isReviver({ slot: seat.slot, player: world.player }),
          ),
          deltaMs,
        ),
      BledOut: () => world,
    })
  }

// NOTE: after the tick's hurts: a player at zero hearts goes down, and a
// downed one bleeds, or is revived by a teammate who stood still beside
// them for COOP_RULES.reviveMs. Who stood still is read before anyone
// changes, so the order of the seats never matters.
export const advanceParty = (world: World, deltaMs: number): World => {
  if (!isCoop(world)) {
    return world
  }
  return forEachSeat(world, advanceSeat(playersOf(world), deltaMs))
}

// THE BREAK

// NOTE: downed and bled-out players come back free at the next break
// (decided row 4), with the revive's hearts, and every player's READY
// clears for it.
export const returnFallen = (world: World): World =>
  isCoop(world)
    ? forEachSeat(world, seatWorld => {
        const waiting = modifyLeadSeat(seatWorld, seat =>
          modifyFields(seat, { readiness: () => 'Waiting' }),
        )
        return isStanding(leadSeatOf(waiting))
          ? waiting
          : standUp(waiting, COOP_RULES.reviveHearts)
      })
    : world

// NOTE: READY from one player (decided 7, row 12): the break ends once
// everyone who is here and standing has pressed it, or when its clock runs
// out. An away player never holds it up.
export const markReady = (world: World): World =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? modifyLeadSeat(world, seat =>
        modifyFields(seat, { readiness: () => 'Ready' }),
      )
    : world

const isHoldingBreak = (seat: Seat): boolean =>
  isHere(seat) && !isDowned(seat) && seat.readiness === 'Waiting'

export const isEveryoneReady = (world: World): boolean =>
  isCoop(world) &&
  !Array.some(playersOf(world), ({ seat }) => isHoldingBreak(seat))

// FRIENDLY FIRE

const isFriendlyFireOn = (world: World): boolean =>
  isCoop(world) && world.difficulty.chosen === 'Nightmare'

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

// NOTE: on Nightmare a teammate's shot that reaches a standing player
// wounds them and stops there (decided row 6). Gnome peas never do. On any
// other difficulty, and in single player, shots pass through teammates.
export const resolveFriendlyFire = (
  world: World,
  seconds: number,
  from: (bullet: Bullet) => Vector,
  firstFreshId: number,
): World => {
  if (!isFriendlyFireOn(world)) {
    return world
  }
  return forEachSeat(world, (seatWorld, slot) => {
    if (
      !isStanding(leadSeatOf(seatWorld)) ||
      Invulnerability.isAnyOf(['Invulnerable'])(
        seatWorld.player.invulnerability,
      )
    ) {
      return seatWorld
    }
    return pipe(
      seatWorld.bullets,
      Array.findFirst(
        bullet =>
          bullet.weapon !== 'Peashooter' &&
          isTeammateShot(slot)(bullet) &&
          sweepHits(seatWorld.player, seconds, from, firstFreshId)(bullet),
      ),
      Option.match({
        onNone: () => seatWorld,
        onSome: bullet => {
          const direction = bulletDirection(bullet)
          return modifyFields(seatWorld, {
            player: player =>
              woundPlayer(player, COOP_RULES.friendlyFireDamage, direction),
            bullets: Array.filter(({ id }) => id !== bullet.id),
            frameEvents: Array.append(
              GameEvent.FriendlyFire({
                x: seatWorld.player.x,
                y: seatWorld.player.y,
                direction,
              }),
            ),
          })
        },
      }),
    )
  })
}
