import { Array, Function, Option, Result, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { SHOP_FIRST_WAVE } from '../../shared/constants'
import { nextRandom } from '../../shared/prng'
import { isMissingHeart, maxHpOf } from '../heroes/calling'
import { type Level, levelOf } from '../level/arena'
import { type LevelSpec, roomSpotsOf } from '../level/plan'
import { type Tile, tileCenter } from '../level/tileGrid'
import {
  atSeat,
  forEachSeat,
  isCoop,
  isStanding,
  seatStateAt,
} from '../party/party'
import { activeModifiersOf } from '../run/dareLadder'
import { isPending } from '../run/lessons'
import type { World } from '../schema/world'
import {
  type Crate,
  CrateRoom,
  CrateStock,
  GameEvent,
  Phase,
  type PlayerSlot,
  type TrapKind,
  type Vector,
} from '../schema/worldSchema'
import { distanceBetween } from '../step/geometry'
import { ownedCount, stockTrap, trapLimitOf } from './traps'

type CrateRules = Readonly<{
  reachPx: number
  firstWave: number
  plankWeight: number
  gnomeWeight: number
  heartChance: number
}>

const CRATE_RULES: CrateRules = {
  reachPx: 8,
  firstWave: SHOP_FIRST_WAVE,
  plankWeight: 1,
  gnomeWeight: 2,
  heartChance: 1,
}

const CRATE_ROOMS: ReadonlyArray<CrateRoom> = CrateRoom.literals

const CRATE_ROOM_BITS: Readonly<Record<CrateRoom, number>> = {
  Dining: 1,
  Kitchen: 2,
  Parlour: 4,
  Library: 8,
  Cellar: 16,
}

const isCrateRoom = (room: string): room is CrateRoom =>
  Array.contains<string>(CRATE_ROOMS, room)

type CrateSpot = Readonly<{ room: CrateRoom; spot: Vector }>

const spotsBySpec = new WeakMap<LevelSpec, ReadonlyArray<CrateSpot>>()

const middleOfTiles = (tiles: Array.NonEmptyReadonlyArray<Tile>): Vector => {
  const first = tileCenter(Array.headNonEmpty(tiles))
  const last = tileCenter(Array.lastNonEmpty(tiles))
  return { x: (first.x + last.x) / 2, y: first.y }
}

const crateSpotsOf = (spec: LevelSpec): ReadonlyArray<CrateSpot> => {
  const cached = spotsBySpec.get(spec)
  if (cached !== undefined) {
    return cached
  }
  const spots = Array.filterMap(roomSpotsOf(spec), ({ room, trapCrates }) => {
    const first = Option.getOrElse(Array.head(trapCrates), () => [])
    return isCrateRoom(room) && Array.isReadonlyArrayNonEmpty(first)
      ? Result.succeed({ room, spot: middleOfTiles(first) })
      : Result.failVoid
  })
  spotsBySpec.set(spec, spots)
  return spots
}

export const crateSpotOf: {
  (room: CrateRoom): (level: Level) => Vector
  (level: Level, room: CrateRoom): Vector
} = Function.dual(2, (level: Level, room: CrateRoom): Vector =>
  pipe(
    crateSpotsOf(level.spec),
    Array.findFirst(each => each.room === room),
    Option.match({ onNone: () => level.start, onSome: ({ spot }) => spot }),
  ),
)

const crateRoomsByLevel = new WeakMap<Level, ReadonlyArray<CrateRoom>>()

const openCrateRoomsOf = (level: Level): ReadonlyArray<CrateRoom> => {
  const cached = crateRoomsByLevel.get(level)
  if (cached !== undefined) {
    return cached
  }
  const openIds = new Set<string>()
  for (const { id, isOpen } of level.rooms) {
    if (isOpen) {
      openIds.add(id)
    }
  }
  const rooms = Array.filterMap(crateSpotsOf(level.spec), ({ room }) =>
    openIds.has(room) ? Result.succeed(room) : Result.failVoid,
  )
  crateRoomsByLevel.set(level, rooms)
  return rooms
}

export const crateRoomsOf = (world: World): ReadonlyArray<CrateRoom> =>
  openCrateRoomsOf(levelOf(world))

const openWaveOf = (world: World): Option.Option<number> =>
  Phase.isAnyOf(['Preparation', 'Wave'])(world.phase) &&
  world.phase.wave >= CRATE_RULES.firstWave
    ? Option.some(world.phase.wave)
    : Option.none()

export const areCratesOpen = (world: World): boolean =>
  Option.isSome(openWaveOf(world))

export type CrateFind = TrapKind | 'Heart'

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

const isHeartDue = (world: World): boolean =>
  !activeModifiersOf(world).glass &&
  Array.some(world.seats, ({ player }) => isMissingHeart(player))

const isTutorialPlank = (world: World, room: CrateRoom): boolean =>
  room === 'Dining' && !isCoop(world) && isPending(world.lessons.dareTour)

const TRAP_WEIGHTS: ReadonlyArray<readonly [TrapKind, number]> = [
  ['Barricade', CRATE_RULES.plankWeight],
  ['Turret', CRATE_RULES.gnomeWeight],
]

const trapChoices = (
  takeable: ReadonlySet<TrapKind>,
  last: Option.Option<TrapKind>,
): ReadonlyArray<readonly [TrapKind, number]> => {
  const open = Array.filter(TRAP_WEIGHTS, ([trap]) => takeable.has(trap))
  const fresh = Array.filter(open, ([trap]) => !Option.contains(last, trap))
  if (Array.isReadonlyArrayNonEmpty(fresh)) {
    return fresh
  }
  return Array.isReadonlyArrayNonEmpty(open) ? open : TRAP_WEIGHTS
}

const rollTrap = (
  state: number,
  takeable: ReadonlySet<TrapKind>,
  last: Option.Option<TrapKind>,
): readonly [CrateStock, number] => {
  const draw = nextRandom(state)
  const choices = trapChoices(takeable, last)
  const total = Array.reduce(choices, 0, (sum, [, weight]) => sum + weight)
  const picked = Array.reduce(
    choices,
    { trap: Option.none<TrapKind>(), left: draw.value * total },
    (pick, [trap, weight]) =>
      Option.isNone(pick.trap) && pick.left < weight
        ? { trap: Option.some(trap), left: pick.left }
        : { trap: pick.trap, left: pick.left - weight },
  )
  return [
    CrateStock.Stocked({
      trap: Option.getOrElse(picked.trap, (): TrapKind => 'Turret'),
    }),
    draw.nextState,
  ]
}

const rollStock = (
  state: number,
  isHeartRolled: boolean,
  takeable: ReadonlySet<TrapKind>,
  last: Option.Option<TrapKind>,
): readonly [CrateStock, number] => {
  if (!isHeartRolled) {
    return rollTrap(state, takeable, last)
  }
  const draw = nextRandom(state)
  return draw.value < CRATE_RULES.heartChance
    ? [CrateStock.Heart(), draw.nextState]
    : rollTrap(draw.nextState, takeable, last)
}

const takeableTraps = (world: World): ReadonlySet<TrapKind> => {
  const takeable = new Set<TrapKind>()
  Array.forEach(world.seats, (_, slot) => {
    for (const [trap] of TRAP_WEIGHTS) {
      if (!takeable.has(trap) && canTakeFind(world, slot, trap)) {
        takeable.add(trap)
      }
    }
  })
  return takeable
}

const lastTrapIn = (world: World, room: CrateRoom): Option.Option<TrapKind> =>
  pipe(
    Array.findFirst(world.crates.crates, crate => crate.room === room),
    Option.flatMap(({ stock }) =>
      CrateStock.match(stock, {
        Stocked: ({ trap }) => Option.some(trap),
        Heart: () => Option.none(),
        Taken: () => Option.none(),
      }),
    ),
  )

type Rolled = Readonly<{
  crates: ReadonlyArray<Crate>
  rngState: number
  isHeartDue: boolean
}>

const rollFor = (world: World, rooms: ReadonlyArray<CrateRoom>): Rolled => {
  const takeable = takeableTraps(world)
  const crates: Array<Crate> = []
  let rngState = world.crates.rngState
  let isDue = isHeartDue(world)
  for (const room of rooms) {
    if (isTutorialPlank(world, room)) {
      const [, nextState] = rollTrap(rngState, takeable, Option.none())
      crates.push({ room, stock: CrateStock.Stocked({ trap: 'Barricade' }) })
      rngState = nextState
    } else {
      const [stock, nextState] = rollStock(
        rngState,
        isDue,
        takeable,
        lastTrapIn(world, room),
      )
      crates.push({ room, stock })
      rngState = nextState
      isDue = isDue && !CrateStock.isAnyOf(['Heart'])(stock)
    }
  }
  return { crates, rngState, isHeartDue: isDue }
}

const restock = (world: World, wave: number): World => {
  const { crates, rngState } = rollFor(world, crateRoomsOf(world))
  return UiStruct.evolve(world, {
    crates: () => ({ rngState, wave, crates }),
  })
}

const addOpenedRooms = (world: World): World => {
  const stocked = Array.reduce(
    world.crates.crates,
    0,
    (mask, crate) => mask | CRATE_ROOM_BITS[crate.room],
  )
  const missing = Array.filter(
    crateRoomsOf(world),
    room => (stocked & CRATE_ROOM_BITS[room]) === 0,
  )
  if (Array.isReadonlyArrayEmpty(missing)) {
    return world
  }
  const { crates: added, rngState } = rollFor(world, missing)
  return UiStruct.evolve(world, {
    crates: crates =>
      UiStruct.evolve(crates, {
        rngState: () => rngState,
        crates: current => Array.appendAll(current, added),
      }),
  })
}

export const canTakeFind: {
  (slot: PlayerSlot, find: CrateFind): (world: World) => boolean
  (world: World, slot: PlayerSlot, find: CrateFind): boolean
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, find: CrateFind): boolean =>
    find === 'Heart'
      ? !activeModifiersOf(world).glass &&
        isMissingHeart(seatStateAt(world, slot).player)
      : ownedCount(world, slot, find) < trapLimitOf(world, find),
)

const heal = (world: World, slot: PlayerSlot): World =>
  UiStruct.evolve(world, {
    seats: atSeat(slot, {
      player: player =>
        UiStruct.evolve(player, {
          hp: hp => Math.min(maxHpOf(player), hp + 1),
        }),
    }),
  })

const giveFind = (
  world: World,
  slot: PlayerSlot,
  find: CrateFind,
  spot: Vector,
): World =>
  find === 'Heart'
    ? UiStruct.evolve(heal(world, slot), {
        frameEvents: Array.append(
          GameEvent.PickupGrabbed({ x: spot.x, y: spot.y, kind: 'Heart' }),
        ),
      })
    : UiStruct.evolve(stockTrap(world, slot, find), {
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
          crateSpotOf(levelOf(world), crate.room),
        ) <= CRATE_RULES.reachPx,
    ),
    Option.match({
      onNone: () => world,
      onSome: ({ crate, find }) =>
        UiStruct.evolve(
          giveFind(world, slot, find, crateSpotOf(levelOf(world), crate.room)),
          {
            crates: crates =>
              UiStruct.evolve(crates, {
                crates: Array.map((current, at) =>
                  at === index
                    ? UiStruct.evolve(current, {
                        stock: () => CrateStock.Taken(),
                      })
                    : current,
                ),
              }),
          },
        ),
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
