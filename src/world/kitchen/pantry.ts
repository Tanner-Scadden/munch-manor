import { Array, Option, Record, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { nextRandom } from '#shared/prng.ts'
import type { SoundEffect } from '#shared/soundEffect.ts'
import { isMissingHeart, maxHpOf } from '#world/heroes/calling.ts'
import { grantKeys } from '#world/keys/keys.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { boxAround } from '#world/level/exits.ts'
import {
  type Box,
  COVER_SYMBOLS,
  tileBox,
  tilesWithSymbol,
} from '#world/level/tileGrid.ts'
import {
  atSeat,
  forEachSeat,
  isStanding,
  seatStateAt,
} from '#world/party/party.ts'
import { activeModifiersOf } from '#world/run/dareLadder.ts'
import type { World } from '#world/schema/world.ts'
import {
  GameEvent,
  Pantry,
  type PantryGoodie,
  type PantryStash,
  Phase,
  type Player,
  type PlayerSlot,
  type Vector,
} from '#world/schema/worldSchema.ts'
import { distanceBetween } from '#world/step/geometry.ts'

import { isKitchenOpen } from './kitchen.ts'

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

export const PANTRY_SOUNDS: Readonly<Record<PantryGoodie, SoundEffect>> = {
  Key: 'Purchase',
  Heart: 'GrabHeart',
}

const PANTRY_SYMBOL = pipe(
  Record.toEntries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Pantry'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'Q'),
)

const pantryBoxes = new WeakMap<Level, Option.Option<Box>>()

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

export const pantrySpotOf = (level: Level): Option.Option<Vector> =>
  Option.map(pantryBoxOf(level), box => ({
    x: Math.round((box.left + box.right) / 2),
    y: box.bottom + PANTRY_RULES.frontPx,
  }))

const roundOf = (world: World): Option.Option<number> =>
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)
    ? Option.some(world.phase.wave)
    : Option.none()

export const maybeStash = (world: World): Option.Option<PantryStash> =>
  Option.flatMap(roundOf(world), wave =>
    Pantry.isAnyOf(['Stocked'])(world.pantry) && world.pantry.round === wave
      ? Option.some(world.pantry)
      : Option.none(),
  )

const stock = (world: World, wave: number): World => {
  const kindDraw = nextRandom((world.rngState ^ PANTRY_SEED_SALT) >>> 0)
  const goodie = Option.getOrElse(
    Array.get(GOODIES, Math.floor(kindDraw.value * GOODIES.length)),
    () => GOODIES[0],
  )
  return UiStruct.evolve(world, {
    pantry: () => Pantry.Stocked({ round: wave, goodie }),
  })
}

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
    ? UiStruct.evolve(world, {
        seats: atSeat(slot, {
          player: player =>
            UiStruct.evolve(player, {
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
        return UiStruct.evolve(give(world, slot, goodie, spot), {
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
