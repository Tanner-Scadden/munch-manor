import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { World } from '../schema/world'
import {
  type GameEvent,
  type Vector,
  type Zombie,
  ZombieAction,
} from '../schema/worldSchema'
import { ZOMBIE_BLAST_TARGET } from '../step/combat'
import { isWalking } from '../zombies/zombies'

// What the room tools that knock zombies over share: a strike that hurts
// (or only shoves, at no damage), knocks the zombie along, and leaves a
// survivor dazed on the floor a moment. Its kills raise ZombieKilled like a
// blast's, so they drop keys (src/world/keys/keys.ts).

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
          target: modifyFields(zombie, {
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
        ? modifyFields(target, {
            action: () =>
              ZombieAction.Dazed({ remainingMs: dazeMs, durationMs: dazeMs }),
          })
        : target,
    events,
  }
}

// NOTE: every zombie the test picks out knocked down, each its own way.
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
    return modifyFields(world, {
      zombies: () => Array.map(outcomes, ({ target }) => target),
      frameEvents: frameEvents => [
        ...frameEvents,
        ...Array.flatMap(outcomes, ({ events }) => events),
      ],
    })
  },
)
