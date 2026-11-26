import { Array, Function, Option, Order, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { PLAYER_RADIUS } from '../../shared/constants'
import * as DetMath from '../../shared/detMath'
import { isCoop, modifySeatRecord } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  type Player,
  type PlayerSlot,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from '../schema/worldSchema'
import { hitEvent, killEvent, strikeZombie } from '../step/combat'
import { directionBetween } from '../step/geometry'
import { bodyRadiusOf, isRoamingAction } from '../zombies/zombies'

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
  const length = DetMath.hypot(to.x, to.y)
  if (length === 0) {
    return 0
  }
  const dot = (facing.x * to.x + facing.y * to.y) / length
  return DetMath.acos(Math.max(-1, Math.min(1, dot)))
}

export const isInArc: {
  (
    reachPx: number,
    halfArc: number,
  ): (player: Player) => (zombie: Zombie) => boolean
  (
    player: Player,
    reachPx: number,
    halfArc: number,
  ): (zombie: Zombie) => boolean
} = Function.dual(
  3,
  (player: Player, reachPx: number, halfArc: number) =>
    (zombie: Zombie): boolean => {
      const offset = { x: zombie.x - player.x, y: zombie.y - player.y }
      const distance = DetMath.hypot(offset.x, offset.y)
      return (
        distance - bodyRadiusOf(zombie) - PLAYER_RADIUS <= reachPx &&
        (distance <= PLAYER_RADIUS + bodyRadiusOf(zombie) ||
          angleBetween(player.facing, offset) <= halfArc)
      )
    },
)

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

export const strikeInMelee: {
  (zombie: Zombie, blow: Blow): (player: Player) => Struck
  (player: Player, zombie: Zombie, blow: Blow): Struck
} = Function.dual(3, (player: Player, zombie: Zombie, blow: Blow): Struck => {
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
      struck.hp > 0 &&
      isSmallKind(zombie.kind) &&
      isRoamingAction(struck.action)
        ? UiStruct.evolve(struck, {
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
})

export type Swing = Readonly<{
  zombies: ReadonlyArray<Zombie>
  events: ReadonlyArray<GameEvent>
  connected: boolean
}>

export const swingAt: {
  (
    strikeOne: (zombie: Zombie) => Option.Option<Struck>,
    swung: GameEvent,
  ): (zombies: ReadonlyArray<Zombie>) => Swing
  (
    zombies: ReadonlyArray<Zombie>,
    strikeOne: (zombie: Zombie) => Option.Option<Struck>,
    swung: GameEvent,
  ): Swing
} = Function.dual(
  3,
  (
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
  },
)

export const maybeNearest: {
  (
    zombies: ReadonlyArray<Zombie>,
    isMet: (zombie: Zombie) => boolean,
  ): (player: Player) => Option.Option<Zombie>
  (
    player: Player,
    zombies: ReadonlyArray<Zombie>,
    isMet: (zombie: Zombie) => boolean,
  ): Option.Option<Zombie>
} = Function.dual(
  3,
  (
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
                DetMath.hypot(zombie.x - player.x, zombie.y - player.y),
              ),
            ),
          ),
      }),
    ),
)

export const countKills = (events: ReadonlyArray<GameEvent>): number =>
  Array.reduce(events, 0, (sum, event) =>
    GameEvent.isAnyOf(['ZombieKilled'])(event) ? sum + 1 : sum,
  )

export const creditStriker: {
  (slot: PlayerSlot, events: ReadonlyArray<GameEvent>): (world: World) => World
  (world: World, slot: PlayerSlot, events: ReadonlyArray<GameEvent>): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, events: ReadonlyArray<GameEvent>): World => {
    const kills = countKills(events)
    return isCoop(world) && kills > 0
      ? modifySeatRecord(world, slot, seat =>
          UiStruct.evolve(seat, { kills: count => count + kills }),
        )
      : world
  },
)
