import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { nextRandom } from '../../shared/prng'
import { killerOf } from '../feats/feats'
import { keyScaleOf } from '../heroes/calling'
import { kitchenKeyScale } from '../kitchen/kitchenKeys'
import { levelOf } from '../level/arena'
import { maybePlayerAt, modifySeatRecord } from '../party/party'
import { brokeKeyScaleOf } from '../run/modifiers'
import type { World } from '../schema/world'
import {
  GameEvent,
  type KeyRing,
  type Vector,
  type ZombieKind,
} from '../schema/worldSchema'
import { ZOMBIE_KINDS } from '../zombies/zombies'

// Skeleton keys (docs/ESCAPE_PLAN.md, layer 7): the crew's one currency, on
// one shared ring in the World (`keys`), spent on padlocked boards and
// fridge pulls (src/world/shop/purchase.ts). Zombies drop them: each kind
// has its odds (ZOMBIE_KINDS' `keys`, a key one time in four for a Groaner,
// two for a Big Lug), raised for the Penny Pincher's kills and on a kitchen
// tile, and halved by Broke. A cleared wave and a frenzied pack wiped out
// each add one more, the pantry may hold one, and the fridge's Dud burps
// one back.
//
// A key goes straight onto the ring at the kill, with a KeysFound event
// there, which the client draws as a key flying up to the ring on the HUD:
// read at a glance, never lost under a horde, and nobody has to leave the
// fight to fetch it. The rolls come from the ring's own generator
// (`keys.rngState`, salted from the run's seed in freshKeys), so a drop
// moves no other roll.

type KeyRules = Readonly<{ perWaveCleared: number; perPackWiped: number }>

export const KEY_RULES: KeyRules = { perWaveCleared: 1, perPackWiped: 1 }

// NOTE: the keys a kill of `kind` drops on average before the killer's
// hero, the kitchen, and Broke have their say: a whole part always, and the
// rest as a chance.
export const keyOddsOf = (kind: ZombieKind): number => ZOMBIE_KINDS[kind].keys

const withRing = (world: World, change: (ring: KeyRing) => KeyRing): World =>
  modifyFields(world, { keys: change })

// NOTE: the keys a seat's kill found go on its own record, for the crew
// board's Key Keeper and the Penny Pincher's glint.
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
            modifyFields(seat, { keysFound: found => found + count }),
          )
        : world,
  })

// NOTE: `count` keys onto the ring, found at `at`. Nothing at all for none.
export const grantKeys: {
  (count: number, at: Vector): (world: World) => World
  (world: World, count: number, at: Vector): World
} = Function.dual(3, (world: World, count: number, at: Vector): World =>
  count > 0
    ? modifyFields(world, {
        keys: ring =>
          modifyFields(ring, {
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

// NOTE: keys off the ring for a buy. The caller checks the ring holds them.
export const spendKeys: {
  (count: number): (world: World) => World
  (world: World, count: number): World
} = Function.dual(2, (world: World, count: number): World =>
  withRing(world, ring =>
    modifyFields(ring, {
      held: held => held - count,
      spent: spent => spent + count,
    }),
  ),
)

export const heldKeys = (world: World): number => world.keys.held

// NOTE: what a kill drops on average: its kind's odds, half again for the
// Penny Pincher's kill, a quarter more on a kitchen tile, and half on
// Broke.
const expectedKeys = (
  world: World,
  kill: typeof GameEvent.ZombieKilled.Type,
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
    brokeKeyScaleOf(world.modifiers)
  )
}

// NOTE: a whole number of keys from an average: its whole part, and one
// more as often as its fraction, drawn from the ring's own generator only
// when there is a fraction to draw for.
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

// NOTE: once a tick, after everything that kills: every kill of the tick
// rolls its keys, in the order the kills happened.
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
      modifyFields(ring, { rngState: () => rngState }),
    )
    return creditFinder(
      grantKeys(rolled, count, event),
      killerOf(current, event),
      count,
    )
  })
