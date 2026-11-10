import { Array, Option, Record, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { nextRandom } from '../../shared/prng'
import type { SoundEffect } from '../../shared/soundEffect'
import { isMissingHeart, maxHpOf } from '../heroes/calling'
import {
  type Box,
  COVER_SYMBOLS,
  type Level,
  levelOf,
  tileBox,
  tilesWithSymbol,
} from '../level/arena'
import { boxAround } from '../level/exits'
import {
  atSeat,
  earn,
  forEachSeat,
  isStanding,
  seatStateAt,
} from '../party/party'
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
// the pantry cupboard in its north-west corner holds one goodie: $15 to $30,
// or a heart for a hurt player. A heart the taker cannot use pays the cash
// instead. (A Lid Stack went with endless ammo.) It sits in
// front of the cupboard for the break, and the first player to walk onto it
// takes it, one a break. The walk is its price.
//
// The goodie is drawn from the World's generator (`rngState`, salted) without
// advancing it, so stocking the pantry never shifts the waves, the drops, or
// the fridge's pulls, and the same break always holds the same goodie.

type PantryRules = Readonly<{
  minCash: number
  maxCash: number
  frontPx: number
  reachPx: number
}>

export const PANTRY_RULES: PantryRules = {
  minCash: 15,
  maxCash: 30,
  frontPx: 5,
  reachPx: 8,
}

const PANTRY_SEED_SALT = 0x9a27c4b1

const GOODIES: Array.NonEmptyReadonlyArray<PantryGoodie> = ['Cash', 'Heart']

// NOTE: the sound of a take: a coin's ching or a heart.
export const PANTRY_SOUNDS: Readonly<Record<PantryGoodie, SoundEffect>> = {
  Cash: 'Purchase',
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

const breakWaveOf = (world: World): Option.Option<number> =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? Option.some(world.phase.wave)
    : Option.none()

// NOTE: the goodie waiting in this break, if there is one.
export const maybeStash = (world: World): Option.Option<PantryStash> =>
  Option.flatMap(breakWaveOf(world), wave =>
    Pantry.isAnyOf(['Stocked'])(world.pantry) && world.pantry.round === wave
      ? Option.some(world.pantry)
      : Option.none(),
  )

// STOCKING

// NOTE: each break with the kitchen open stocks the pantry once, also in a
// break where the kitchen has just been opened.
const stock = (world: World, wave: number): World => {
  const kindDraw = nextRandom((world.rngState ^ PANTRY_SEED_SALT) >>> 0)
  const cashDraw = nextRandom(kindDraw.nextState)
  const goodie = Option.getOrElse(
    Array.get(GOODIES, Math.floor(kindDraw.value * GOODIES.length)),
    () => GOODIES[0],
  )
  const cash =
    PANTRY_RULES.minCash +
    Math.floor(
      cashDraw.value * (PANTRY_RULES.maxCash - PANTRY_RULES.minCash + 1),
    )
  return modifyFields(world, {
    pantry: () => Pantry.Stocked({ round: wave, goodie, cash }),
  })
}

// TAKING


// NOTE: what the stash gives this taker: the goodie if they can use it, else
// its cash. A Glass run's one heart stays one heart.
const goodieFor = (
  world: World,
  player: Player,
  goodie: PantryGoodie,
): PantryGoodie => {
  const isUsable = {
    Cash: true,
    Heart: isMissingHeart(player) && !world.modifiers.glass,
  }[goodie]
  return isUsable ? goodie : 'Cash'
}

const give = (
  world: World,
  slot: PlayerSlot,
  goodie: PantryGoodie,
  cash: number,
): World =>
  modifyFields(world, {
    seats: atSeat(slot, {
      player: player =>
        goodie === 'Heart'
          ? modifyFields(player, {
              hp: hp => Math.min(maxHpOf(player), hp + 1),
            })
          : player,
      wallet: wallet => (goodie === 'Cash' ? earn(wallet, cash) : wallet),
    }),
  })

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
        return modifyFields(give(world, slot, goodie, stash.cash), {
          pantry: () => Pantry.Bare({ round: stash.round }),
          frameEvents: frameEvents => [
            ...frameEvents,
            GameEvent.PantryTaken({
              x: spot.x,
              y: spot.y,
              goodie,
              cash: goodie === 'Cash' ? stash.cash : 0,
            }),
          ],
        })
      },
    }),
  )
}

// NOTE: one tick of the pantry: stock it at a break with the kitchen open,
// then the first standing player in slot order on the spot takes it.
export const advancePantry = (world: World): World =>
  Option.match(breakWaveOf(world), {
    onNone: () => world,
    onSome: wave => {
      if (!isKitchenOpen(levelOf(world))) {
        return world
      }
      const stocked = world.pantry.round === wave ? world : stock(world, wave)
      return forEachSeat(stocked, takeFor)
    },
  })
