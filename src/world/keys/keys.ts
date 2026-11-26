import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { nextRandom } from '#shared/prng.ts'
import { killerOf } from '#world/feats/feats.ts'
import { keyScaleOf } from '#world/heroes/calling.ts'
import { kitchenKeyScale } from '#world/kitchen/kitchenKeys.ts'
import { levelOf } from '#world/level/arena.ts'
import { maybePlayerAt, modifySeatRecord } from '#world/party/party.ts'
import { activeModifiersOf } from '#world/run/dareLadder.ts'
import { brokeKeyScaleOf } from '#world/run/modifiers.ts'
import type { World } from '#world/schema/world.ts'
import {
  GameEvent,
  type KeyRing,
  type Vector,
  type ZombieKind,
} from '#world/schema/worldSchema.ts'
import { ZOMBIE_KINDS } from '#world/zombies/zombies.ts'

type KeyRules = Readonly<{ perWaveCleared: number; perPackWiped: number }>

export const KEY_RULES: KeyRules = { perWaveCleared: 1, perPackWiped: 1 }

export const keyOddsOf = (kind: ZombieKind): number => ZOMBIE_KINDS[kind].keys

const withRing = (world: World, change: (ring: KeyRing) => KeyRing): World =>
  UiStruct.evolve(world, { keys: change })

const creditFinder = (
  world: World,
  maybeFinder: Option.Option<number>,
  count: number,
): World =>
  Option.match(maybeFinder, {
    onNone: () => world,
    onSome: slot =>
      count > 0
        ? modifySeatRecord(world, slot, seat =>
            UiStruct.evolve(seat, { keysFound: found => found + count }),
          )
        : world,
  })

export const grantKeys: {
  (count: number, at: Vector): (world: World) => World
  (world: World, count: number, at: Vector): World
} = Function.dual(3, (world: World, count: number, at: Vector): World =>
  count > 0
    ? UiStruct.evolve(world, {
        keys: ring =>
          UiStruct.evolve(ring, {
            held: held => held + count,
            found: found => found + count,
          }),
        frameEvents: events => [
          ...events,
          GameEvent.KeysFound({ x: at.x, y: at.y, count }),
        ],
      })
    : world,
)

export const spendKeys: {
  (count: number): (world: World) => World
  (world: World, count: number): World
} = Function.dual(2, (world: World, count: number): World =>
  withRing(world, ring =>
    UiStruct.evolve(ring, {
      held: held => held - count,
      spent: spent => spent + count,
    }),
  ),
)

export const heldKeys = (world: World): number => world.keys.held

const expectedKeys = (
  world: World,
  kill: typeof GameEvent.cases.ZombieKilled.Type,
): number => {
  const killerScale = Option.match(
    Option.flatMap(killerOf(world, kill), slot => maybePlayerAt(world, slot)),
    {
      onNone: () => 1,
      onSome: ({ player }) => keyScaleOf(player),
    },
  )
  return (
    keyOddsOf(kill.kind) *
    killerScale *
    kitchenKeyScale(levelOf(world), kill) *
    brokeKeyScaleOf(activeModifiersOf(world))
  )
}

const rollKeys = (
  rngState: number,
  expected: number,
): readonly [count: number, rngState: number] => {
  const whole = Math.floor(expected)
  const fraction = expected - whole
  if (fraction <= 0) {
    return [whole, rngState]
  }
  const draw = nextRandom(rngState)
  return [whole + (draw.value < fraction ? 1 : 0), draw.nextState]
}

export const dropKeys = (world: World): World =>
  Array.reduce(world.frameEvents, world, (current, event) => {
    if (event._tag !== 'ZombieKilled') {
      return current
    }
    const [count, rngState] = rollKeys(
      current.keys.rngState,
      expectedKeys(current, event),
    )
    const rolled = withRing(current, ring =>
      UiStruct.evolve(ring, { rngState: () => rngState }),
    )
    return creditFinder(
      grantKeys(rolled, count, event),
      killerOf(current, event),
      count,
    )
  })
