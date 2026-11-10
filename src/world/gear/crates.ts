import { Array, Function, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { SHOP_FIRST_WAVE } from '../../shared/constants'
import { nextRandom } from '../../shared/prng'
import { isMissingHeart, maxHpOf } from '../heroes/calling'
import { isKitchenOpen } from '../kitchen/kitchen'
import { type Tile, levelOf, tileCenter } from '../level/arena'
import {
  atSeat,
  forEachSeat,
  isCoop,
  isStanding,
  seatStateAt,
} from '../party/party'
import { isPending } from '../run/lessons'
import type { World } from '../schema/world'
import {
  type Crate,
  type CrateRoom,
  CrateStock,
  GameEvent,
  Phase,
  type PlayerSlot,
  type TrapKind,
  type Vector,
} from '../schema/worldSchema'
import { distanceBetween } from '../step/geometry'
import { ownedCount, stockTrap, trapLimitOf } from './traps'

// Trap crates (docs/ESCAPE_PLAN.md, layer 6): traps are found in the house,
// not bought. A crate stands in each open room, the parlour's from the start
// and the kitchen's once the kitchen is open, and in a break it stands open
// with one trap in it: a Plank Pile or a Grumpy Gnome. The first standing
// player (in slot order) to walk onto it takes it, unless they already have
// as many of that trap as they may (two Plank Piles placed or carried, two
// Grumpy Gnomes), and then it waits for someone who can.
//
// Restocking: at the start of each break every crate holds a fresh roll,
// taken or not. A crate whose find nobody could take (two Plank Piles out
// and another Plank Pile in the crate) would otherwise hold it for the
// rest of the run, so it rolls again too. Crates open from the first
// break that sold traps before (SHOP_FIRST_WAVE), and stay shut in a wave.
//
// Hearts: with no heart to buy, the crates are the house's mercy. While
// someone in the crew is missing a heart when a crate rolls, it may hold a
// Pickled Heart in place of a trap (heartChance, at most one crate a
// break). Only a standing player missing a heart takes it, and it heals
// one. Never in a Glass run, whose one heart stays one heart.
//
// The rolls come from the crates' own generator (`crates.rngState`, salted
// from the run's seed in freshCrates), so they move no other roll. In a new
// player's guided first break the parlour crate always holds a Plank Pile,
// the trap the tutorial teaches (src/features/onboarding/firstBreakQuest.ts).

type CrateRules = Readonly<{
  reachPx: number
  firstWave: number
  plankWeight: number
  gnomeWeight: number
  heartChance: number
}>

// NOTE: a Plank Pile comes up three times in five: planks are the trap a
// player wants two of, and a gnome is the stronger find.
const CRATE_RULES: CrateRules = {
  reachPx: 8,
  firstWave: SHOP_FIRST_WAVE,
  plankWeight: 3,
  gnomeWeight: 2,
  heartChance: 1,
}

// WHERE

// NOTE: the floor tile each room's crate stands on, out of the doorways'
// way: the parlour's bottom-left corner, the kitchen's bottom-right.
const CRATE_TILES: Readonly<Record<CrateRoom, Tile>> = {
  Parlour: { column: 2, row: 15 },
  Kitchen: { column: 16, row: -2 },
}

export const crateSpotOf = (room: CrateRoom): Vector =>
  tileCenter(CRATE_TILES[room])

// NOTE: the rooms a crate stands in: the parlour, and the kitchen once open.
export const crateRoomsOf = (world: World): ReadonlyArray<CrateRoom> =>
  isKitchenOpen(levelOf(world)) ? ['Parlour', 'Kitchen'] : ['Parlour']

// NOTE: the wave of the break the crates are open in, if they are.
const openWaveOf = (world: World): Option.Option<number> =>
  Phase.isAnyOf(['Preparation'])(world.phase) &&
  world.phase.wave >= CRATE_RULES.firstWave
    ? Option.some(world.phase.wave)
    : Option.none()

export const areCratesOpen = (world: World): boolean =>
  Option.isSome(openWaveOf(world))

// NOTE: what a crate can hold: a trap, or a Pickled Heart.
export type CrateFind = TrapKind | 'Heart'

// NOTE: what a crate holds right now: only in a break, only stocked.
export const maybeFindIn: {
  (crate: Crate): (world: World) => Option.Option<CrateFind>
  (world: World, crate: Crate): Option.Option<CrateFind>
} = Function.dual(2, (world: World, crate: Crate): Option.Option<CrateFind> =>
  areCratesOpen(world)
    ? CrateStock.match(crate.stock, {
        Stocked: ({ trap }): Option.Option<CrateFind> => Option.some(trap),
        Heart: (): Option.Option<CrateFind> => Option.some('Heart'),
        Taken: () => Option.none(),
      })
    : Option.none(),
)

// NOTE: a crate may hold a heart while anyone in the crew is missing one,
// never under Glass.
const isHeartDue = (world: World): boolean =>
  !world.modifiers.glass &&
  Array.some(world.seats, ({ player }) => isMissingHeart(player))

// STOCKING

const isTutorialPlank = (world: World, room: CrateRoom): boolean =>
  room === 'Parlour' && !isCoop(world) && isPending(world.lessons.openBreak)

const rollTrap = (state: number): readonly [CrateStock, number] => {
  const draw = nextRandom(state)
  const total = CRATE_RULES.plankWeight + CRATE_RULES.gnomeWeight
  return [
    CrateStock.Stocked({
      trap:
        draw.value * total < CRATE_RULES.plankWeight ? 'Barricade' : 'Turret',
    }),
    draw.nextState,
  ]
}

// NOTE: a heart first, while one is due, then a trap.
const rollStock = (
  state: number,
  isHeartRolled: boolean,
): readonly [CrateStock, number] => {
  if (!isHeartRolled) {
    return rollTrap(state)
  }
  const draw = nextRandom(state)
  return draw.value < CRATE_RULES.heartChance
    ? [CrateStock.Heart(), draw.nextState]
    : rollTrap(draw.nextState)
}

type Rolled = Readonly<{
  crates: ReadonlyArray<Crate>
  rngState: number
  isHeartDue: boolean
}>

// NOTE: a fresh find for each of `rooms`, in order, from the crates' stream;
// once one holds a heart, the rest hold traps.
const rollFor = (world: World, rooms: ReadonlyArray<CrateRoom>): Rolled => {
  const start: Rolled = {
    crates: [],
    rngState: world.crates.rngState,
    isHeartDue: isHeartDue(world),
  }
  return Array.reduce(rooms, start, (rolled, room): Rolled => {
    if (isTutorialPlank(world, room)) {
      const [, rngState] = rollTrap(rolled.rngState)
      const crate: Crate = {
        room,
        stock: CrateStock.Stocked({ trap: 'Barricade' }),
      }
      return modifyFields(rolled, {
        crates: Array.append(crate),
        rngState: () => rngState,
      })
    }
    const [stock, rngState] = rollStock(rolled.rngState, rolled.isHeartDue)
    return {
      crates: Array.append(rolled.crates, { room, stock }),
      rngState,
      isHeartDue: rolled.isHeartDue && !CrateStock.isAnyOf(['Heart'])(stock),
    }
  })
}

// NOTE: every open room's crate rolls a fresh trap, in room order.
const restock = (world: World, wave: number): World => {
  const { crates, rngState } = rollFor(world, crateRoomsOf(world))
  return modifyFields(world, {
    crates: () => ({ rngState, wave, crates }),
  })
}

// NOTE: a room opened mid-break (the kitchen) gets its crate at once.
const addOpenedRooms = (world: World): World => {
  const missing = Array.filter(
    crateRoomsOf(world),
    room => !Array.some(world.crates.crates, crate => crate.room === room),
  )
  if (Array.isReadonlyArrayEmpty(missing)) {
    return world
  }
  const { crates: added, rngState } = rollFor(world, missing)
  return modifyFields(world, {
    crates: crates =>
      modifyFields(crates, {
        rngState: () => rngState,
        crates: current => Array.appendAll(current, added),
      }),
  })
}

// TAKING

// NOTE: a trap within the caps, or a heart for a player missing one.
export const canTakeFind: {
  (slot: PlayerSlot, find: CrateFind): (world: World) => boolean
  (world: World, slot: PlayerSlot, find: CrateFind): boolean
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, find: CrateFind): boolean =>
    find === 'Heart'
      ? !world.modifiers.glass &&
        isMissingHeart(seatStateAt(world, slot).player)
      : ownedCount(world, slot, find) < trapLimitOf(world, find),
)

const heal = (world: World, slot: PlayerSlot): World =>
  modifyFields(world, {
    seats: atSeat(slot, {
      player: player =>
        modifyFields(player, {
          hp: hp => Math.min(maxHpOf(player), hp + 1),
        }),
    }),
  })

// NOTE: a heart heals and says so as a grabbed heart does (its sound,
// callout, and sparkle); a trap goes into the taker's stock.
const giveFind = (
  world: World,
  slot: PlayerSlot,
  find: CrateFind,
  spot: Vector,
): World =>
  find === 'Heart'
    ? modifyFields(heal(world, slot), {
        frameEvents: Array.append(
          GameEvent.PickupGrabbed({ x: spot.x, y: spot.y, kind: 'Heart' }),
        ),
      })
    : modifyFields(stockTrap(world, slot, find), {
        frameEvents: Array.append(
          GameEvent.CrateTaken({ x: spot.x, y: spot.y, trap: find }),
        ),
      })

const takeAt = (world: World, slot: PlayerSlot, index: number): World =>
  pipe(
    Array.get(world.crates.crates, index),
    Option.flatMap(crate =>
      Option.map(maybeFindIn(world, crate), find => ({ crate, find })),
    ),
    Option.filter(
      ({ crate, find }) =>
        canTakeFind(world, slot, find) &&
        distanceBetween(
          seatStateAt(world, slot).player,
          crateSpotOf(crate.room),
        ) <= CRATE_RULES.reachPx,
    ),
    Option.match({
      onNone: () => world,
      onSome: ({ crate, find }) =>
        modifyFields(giveFind(world, slot, find, crateSpotOf(crate.room)), {
          crates: crates =>
            modifyFields(crates, {
              crates: Array.map((current, at) =>
                at === index
                  ? modifyFields(current, { stock: () => CrateStock.Taken() })
                  : current,
              ),
            }),
        }),
    }),
  )

const takeFor = (world: World, slot: PlayerSlot): World =>
  isStanding(seatStateAt(world, slot).seat)
    ? Array.reduce(
        Array.makeBy(world.crates.crates.length, index => index),
        world,
        (current, index) => takeAt(current, slot, index),
      )
    : world

// NOTE: one tick of the crates: a new break restocks them, a room opened in
// it gets its crate, then standing players in slot order take what they
// walk onto.
export const advanceCrates = (world: World): World =>
  Option.match(openWaveOf(world), {
    onNone: () => world,
    onSome: wave => {
      const stocked =
        world.crates.wave === wave
          ? addOpenedRooms(world)
          : restock(world, wave)
      return forEachSeat(stocked, takeFor)
    },
  })
