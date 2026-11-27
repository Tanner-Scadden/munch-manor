import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { World } from '#world/schema/world.ts'
import {
  type GameEvent,
  type Vector,
  type Zombie,
  ZombieAction,
} from '#world/schema/worldSchema.ts'
import { ZOMBIE_BLAST_TARGET } from '#world/step/combat.ts'
import { isWalking } from '#world/zombies/zombies.ts'

export type Knock = Readonly<{
  damage: number
  direction: Vector
  knockbackSpeed: number
  dazeMs: number
}>

const knock = (
  zombie: Zombie,
  { damage, direction, knockbackSpeed, dazeMs }: Knock,
): Readonly<{ target: Zombie; events: ReadonlyArray<GameEvent> }> => {
  const { target, events } =
    damage > 0
      ? ZOMBIE_BLAST_TARGET.hurt(zombie, { damage, direction, knockbackSpeed })
      : {
          target: UiStruct.evolve(zombie, {
            knockback: () => ({
              x: direction.x * knockbackSpeed,
              y: direction.y * knockbackSpeed,
            }),
          }),
          events: [],
        }
  return {
    target:
      isWalking(target) && target.hp > 0
        ? UiStruct.evolve(target, {
            action: () =>
              ZombieAction.Dazed({ remainingMs: dazeMs, durationMs: dazeMs }),
          })
        : target,
    events,
  }
}

export const knockDownWhere: {
  (knockOf: (zombie: Zombie) => Option.Option<Knock>): (world: World) => World
  (world: World, knockOf: (zombie: Zombie) => Option.Option<Knock>): World
} = Function.dual(
  2,
  (world: World, knockOf: (zombie: Zombie) => Option.Option<Knock>): World => {
    const blows = Array.map(world.zombies, zombie => knockOf(zombie))
    if (!Array.some(blows, Option.isSome)) {
      return world
    }
    const outcomes = Array.map(
      Array.zip(world.zombies, blows),
      ([zombie, blow]) =>
        Option.match(blow, {
          onNone: () => ({ target: zombie, events: [] }),
          onSome: each => knock(zombie, each),
        }),
    )
    return UiStruct.evolve(world, {
      zombies: () => Array.map(outcomes, ({ target }) => target),
      frameEvents: frameEvents => [
        ...frameEvents,
        ...Array.flatMap(outcomes, ({ events }) => events),
      ],
    })
  },
)
