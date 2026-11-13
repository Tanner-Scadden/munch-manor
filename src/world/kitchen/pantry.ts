import { Array, Option, Record, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { nextRandom } from '../../shared/prng'
import type { SoundEffect } from '../../shared/soundEffect'
import { isMissingHeart, maxHpOf } from '../heroes/calling'
import { grantKeys } from '../keys/keys'
import { type Level, levelOf } from '../level/arena'
import { boxAround } from '../level/exits'
import {
  type Box,
  COVER_SYMBOLS,
  tileBox,
  tilesWithSymbol,
} from '../level/tileGrid'
import { atSeat, forEachSeat, isStanding, seatStateAt } from '../party/party'
import { activeModifiersOf } from '../run/dareLadder'
import type { World } from '../schema/world'
import {
  GameEvent,
  Pantry,
  type PantryGoodie,
  type PantryStash,
  Phase,
  type Player,
  type PlayerSlot,
  type Vector,
} from '../schema/worldSchema'
import { distanceBetween } from '../step/geometry'
import { isKitchenOpen } from './kitchen'

// The pantry stash (owner, 2026-11-02): once the kitchen is open, each break
// the pantry cupboard in its north-west corner holds one goodie: a skeleton
// key for the crew's ring (it held $15 to $30 before keys, docs/ESCAPE_PLAN.md
// layer 7), or a heart for a hurt player. A heart the taker cannot use is a
// key instead. (A Lid Stack went with endless ammo.) It sits in
// front of the cupboard for the round, the break and the wave after it
// (since 2026-11-10; it was the break only), and the first player to walk
// onto it takes it, one a round. The walk is its price: in a fight, a walk
// to the kitchen's far corner.
//
// The goodie is drawn from the World's generator (`rngState`, salted) without
// advancing it, so stocking the pantry never shifts the waves, the drops, or
// the fridge's pulls, and the same break always holds the same goodie.

type PantryRules = Readonly<{
  keys: number
  frontPx: number
  reachPx: number
}>

export const PANTRY_RULES: PantryRules = {
  keys: 1,
  frontPx: 5,
  reachPx: 8,
}

const PANTRY_SEED_SALT = 0x9a27c4b1

const GOODIES: Array.NonEmptyReadonlyArray<PantryGoodie> = ['Key', 'Heart']

// NOTE: the sound of a take: a key's ching or a heart.
export const PANTRY_SOUNDS: Readonly<Record<PantryGoodie, SoundEffect>> = {
  Key: 'Purchase',
  Heart: 'GrabHeart',
}

// WHERE

const PANTRY_SYMBOL = pipe(
  Record.toEntries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Pantry'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'Q'),
)

const pantryBoxes = new WeakMap<Level, Option.Option<Box>>()

// NOTE: the pantry cupboard's tiles on the map; a level keeps its box.
const pantryBoxOf = (level: Level): Option.Option<Box> => {
  const cached = pantryBoxes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const box = boxAround(
    Array.map(tilesWithSymbol(level, PANTRY_SYMBOL), tileBox),
  )
  pantryBoxes.set(level, box)
  return box
}

// NOTE: the goodie sits on the floor in front of the cupboard's doors.
export const pantrySpotOf = (level: Level): Option.Option<Vector> =>
  Option.map(pantryBoxOf(level), box => ({
    x: Math.round((box.left + box.right) / 2),
    y: box.bottom + PANTRY_RULES.frontPx,
  }))

// NOTE: the round the pantry stocks for: a break and the wave after it share
// one goodie, keyed by the round's wave number.
const roundOf = (world: World): Option.Option<number> =>
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)
    ? Option.some(world.phase.wave)
    : Option.none()

// NOTE: the goodie waiting in this round, if there is one.
export const maybeStash = (world: World): Option.Option<PantryStash> =>
  Option.flatMap(roundOf(world), wave =>
    Pantry.isAnyOf(['Stocked'])(world.pantry) && world.pantry.round === wave
      ? Option.some(world.pantry)
      : Option.none(),
  )

// STOCKING

// NOTE: each round with the kitchen open stocks the pantry once, also in a
// round where the kitchen has just been opened.
const stock = (world: World, wave: number): World => {
  const kindDraw = nextRandom((world.rngState ^ PANTRY_SEED_SALT) >>> 0)
  const goodie = Option.getOrElse(
    Array.get(GOODIES, Math.floor(kindDraw.value * GOODIES.length)),
    () => GOODIES[0],
  )
  return modifyFields(world, {
    pantry: () => Pantry.Stocked({ round: wave, goodie }),
  })
}

// TAKING

// NOTE: what the stash gives this taker: the goodie if they can use it, else
// a key. A Glass run's one heart stays one heart.
const goodieFor = (
  world: World,
  player: Player,
  goodie: PantryGoodie,
): PantryGoodie => {
  const isUsable = {
    Key: true,
    Heart: isMissingHeart(player) && !activeModifiersOf(world).glass,
  }[goodie]
  return isUsable ? goodie : 'Key'
}

const give = (
  world: World,
  slot: PlayerSlot,
  goodie: PantryGoodie,
  spot: Vector,
): World =>
  goodie === 'Heart'
    ? modifyFields(world, {
        seats: atSeat(slot, {
          player: player =>
            modifyFields(player, {
              hp: hp => Math.min(maxHpOf(player), hp + 1),
            }),
        }),
      })
    : grantKeys(world, PANTRY_RULES.keys, spot)

const takeFor = (world: World, slot: PlayerSlot): World => {
  const { seat, player } = seatStateAt(world, slot)
  return pipe(
    maybeStash(world),
    Option.filter(() => isStanding(seat)),
    Option.flatMap(stash =>
      Option.flatMap(pantrySpotOf(levelOf(world)), spot =>
        distanceBetween(player, spot) <= PANTRY_RULES.reachPx
          ? Option.some({ stash, spot })
          : Option.none(),
      ),
    ),
    Option.match({
      onNone: () => world,
      onSome: ({ stash, spot }) => {
        const goodie = goodieFor(world, player, stash.goodie)
        return modifyFields(give(world, slot, goodie, spot), {
          pantry: () => Pantry.Bare({ round: stash.round }),
          frameEvents: frameEvents => [
            ...frameEvents,
            GameEvent.PantryTaken({ x: spot.x, y: spot.y, goodie }),
          ],
        })
      },
    }),
  )
}

// NOTE: one tick of the pantry: stock it each round with the kitchen open,
// then the first standing player in slot order on the spot takes it.
export const advancePantry = (world: World): World =>
  Option.match(roundOf(world), {
    onNone: () => world,
    onSome: wave => {
      if (!isKitchenOpen(levelOf(world))) {
        return world
      }
      const stocked = world.pantry.round === wave ? world : stock(world, wave)
      return forEachSeat(stocked, takeFor)
    },
  })
