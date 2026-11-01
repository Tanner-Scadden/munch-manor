import { Array, Option, Order, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { bountyOf, hitEvent, killEvent, strikeZombie } from './combat'
import { PLAYER_RADIUS } from './constants'
import { directionBetween } from './geometry'
import { earnKill, isCoop, modifyLeadSeat } from './party'
import type { World } from './world'
import {
  GameEvent,
  type Player,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from './worldSchema'
import { bodyRadiusOf } from './zombies'

// Melee: a blow in front of the player at the zombies within reach, with no
// bullet. The knife every player carries (src/knife.ts) and the Clang Pan
// from the fridge (src/fridgeWeapons.ts) both strike through here, so a
// stab and a swing find their targets, hurt, shove, pay, and credit the
// same way.

// NOTE: the kinds a blow can daze (and Brain Freeze freezes solid). The
// rest, the Big Lug and Uncle Chunk, are too big: only slowed, only shoved.
const SMALL_KINDS: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Exploder',
  'Thrower',
  'Crawler',
]

export const isSmallKind = (kind: ZombieKind): boolean =>
  Array.contains(SMALL_KINDS, kind)

const angleBetween = (facing: Vector, to: Vector): number => {
  const length = Math.hypot(to.x, to.y)
  if (length === 0) {
    return 0
  }
  const dot = (facing.x * to.x + facing.y * to.y) / length
  return Math.acos(Math.max(-1, Math.min(1, dot)))
}

// NOTE: whether a zombie's body is within `reachPx` of the player's edge
// and inside the arc either side of the facing. One pressed against the
// player counts from any side.
export const isInArc =
  (player: Player, reachPx: number, halfArc: number) =>
  (zombie: Zombie): boolean => {
    const offset = { x: zombie.x - player.x, y: zombie.y - player.y }
    const distance = Math.hypot(offset.x, offset.y)
    return (
      distance - bodyRadiusOf(zombie) - PLAYER_RADIUS <= reachPx &&
      (distance <= PLAYER_RADIUS + bodyRadiusOf(zombie) ||
        angleBetween(player.facing, offset) <= halfArc)
    )
  }

const isRoaming = ZombieAction.isAnyOf(['Roaming'])

// NOTE: one blow's weight. `maybeDazeMs` dazes a small zombie that was
// roaming; `struck` is the event the views and sounds read for a hit.
export type Blow = Readonly<{
  damage: number
  knockback: number
  maybeDazeMs: Option.Option<number>
  struck: (at: Vector, direction: Vector) => GameEvent
}>

export type Struck = Readonly<{
  zombie: Zombie
  events: ReadonlyArray<GameEvent>
}>

// NOTE: one zombie met by a blow: hurt, shoved away from the player, maybe
// dazed, and killed if that was its last heart.
export const strikeInMelee = (
  player: Player,
  zombie: Zombie,
  blow: Blow,
): Struck => {
  const direction = Option.getOrElse(
    directionBetween(player, zombie),
    () => player.facing,
  )
  const struck = strikeZombie(
    zombie,
    { damage: blow.damage, direction, knockbackSpeed: blow.knockback },
    'Shot',
  )
  const dazed = Option.match(blow.maybeDazeMs, {
    onNone: () => struck,
    onSome: dazeMs =>
      struck.hp > 0 && isSmallKind(zombie.kind) && isRoaming(struck.action)
        ? modifyFields(struck, {
            action: () =>
              ZombieAction.Reeling({
                remainingMs: dazeMs,
                durationMs: dazeMs,
              }),
          })
        : struck,
  })
  return {
    zombie: dazed,
    events: [
      hitEvent(zombie, zombie, direction, blow.damage),
      blow.struck(zombie, direction),
      ...(dazed.hp <= 0 ? [killEvent(dazed, direction)] : []),
    ],
  }
}

// NOTE: what a swing or a stab did: the zombies after it, its events (the
// blow itself first), and whether it met anything.
export type Swing = Readonly<{
  zombies: ReadonlyArray<Zombie>
  events: ReadonlyArray<GameEvent>
  connected: boolean
}>

// NOTE: a blow at each zombie `strikeOne` picks out; the rest are left be.
export const swingAt = (
  zombies: ReadonlyArray<Zombie>,
  strikeOne: (zombie: Zombie) => Option.Option<Struck>,
  swung: GameEvent,
): Swing => {
  const outcomes = Array.map(zombies, strikeOne)
  return {
    zombies: Array.map(zombies, (zombie, index) =>
      Option.match(Option.flatten(Option.fromNullishOr(outcomes[index])), {
        onNone: () => zombie,
        onSome: outcome => outcome.zombie,
      }),
    ),
    events: [
      swung,
      ...Array.flatMap(Array.getSomes(outcomes), ({ events }) => events),
    ],
    connected: Array.some(outcomes, Option.isSome),
  }
}

// NOTE: the zombie nearest the player among those a test picks out, for a
// blow that meets only one.
export const maybeNearest = (
  player: Player,
  zombies: ReadonlyArray<Zombie>,
  isMet: (zombie: Zombie) => boolean,
): Option.Option<Zombie> =>
  pipe(
    Array.filter(zombies, isMet),
    Array.match({
      onEmpty: () => Option.none(),
      onNonEmpty: met =>
        Option.some(
          Array.min(
            met,
            Order.mapInput(Order.Number, (zombie: Zombie) =>
              Math.hypot(zombie.x - player.x, zombie.y - player.y),
            ),
          ),
        ),
    }),
  )

export const countKills = (events: ReadonlyArray<GameEvent>): number =>
  Array.reduce(events, 0, (sum, event) =>
    GameEvent.isAnyOf(['ZombieKilled'])(event) ? sum + 1 : sum,
  )

// NOTE: a seat's own strike pays that seat and credits it the kills; the
// seat stands in the World's per-player fields while it strikes.
export const payStriker = (
  world: World,
  events: ReadonlyArray<GameEvent>,
): World => {
  const bounty = bountyOf(events)
  const kills = countKills(events)
  const paid = bounty > 0 ? earnKill(world, bounty) : world
  return isCoop(paid) && kills > 0
    ? modifyLeadSeat(paid, seat =>
        modifyFields(seat, { kills: count => count + kills }),
      )
    : paid
}
