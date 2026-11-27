import { Array, Option, Order } from 'effect'

import { UiStruct } from '@effect/ui'

import { PLAYER_RADIUS, TILE_SIZE } from '#shared/constants.ts'
import * as DetMath from '#shared/detMath.ts'
import {
  type Level,
  levelOf,
  maybeExit,
  openExitIn,
} from '#world/level/arena.ts'
import { LIBRARY_ROOM_ID, SECRET_EXIT, type Side } from '#world/level/plan.ts'
import type { Tile } from '#world/level/tileGrid.ts'
import { isStanding, playersOf } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import { GameEvent, Phase, type Vector } from '#world/schema/worldSchema.ts'

type ShelfRules = Readonly<{ reachPx: number; bookOutPx: number }>

export const SHELF_RULES: ShelfRules = { reachPx: 4, bookOutPx: 2 }

const BOOK_DOWN_PX = 7

export type SecretShelf = Readonly<{ tile: Tile; side: Side; book: Vector }>

const BY_ROW = Order.mapInput(Order.Number, ({ row }: Tile) => row)

const shelves = new WeakMap<Level, Option.Option<SecretShelf>>()

const shelfIn = (level: Level): Option.Option<SecretShelf> =>
  Option.flatMap(
    Option.all({
      exit: maybeExit(level, SECRET_EXIT),
      library: Array.findFirst(level.rooms, ({ id }) => id === LIBRARY_ROOM_ID),
    }),
    ({ exit, library }) => {
      const inLibrary = Array.filter(
        exit.tiles,
        ({ column }) =>
          column * TILE_SIZE >= library.box.left &&
          (column + 1) * TILE_SIZE <= library.box.right,
      )
      return Option.map(
        Array.head(Array.sort(inLibrary, BY_ROW)),
        (tile): SecretShelf => {
          const side: Side =
            tile.column * TILE_SIZE === library.box.left ? 'West' : 'East'
          return {
            tile,
            side,
            book: {
              x:
                side === 'West'
                  ? (tile.column + 1) * TILE_SIZE + SHELF_RULES.bookOutPx
                  : tile.column * TILE_SIZE - SHELF_RULES.bookOutPx,
              y: tile.row * TILE_SIZE + BOOK_DOWN_PX,
            },
          }
        },
      )
    },
  )

export const secretShelfOf = (level: Level): Option.Option<SecretShelf> => {
  const cached = shelves.get(level)
  if (cached !== undefined) {
    return cached
  }
  const shelf = shelfIn(level)
  shelves.set(level, shelf)
  return shelf
}

const isShelfShut = (level: Level): boolean =>
  Option.exists(
    maybeExit(level, SECRET_EXIT),
    ({ isOpen, requires }) =>
      !isOpen &&
      Array.every(requires, required =>
        Array.contains(level.openExits, required),
      ),
  )

const isAtBook = (book: Vector, player: Vector): boolean =>
  DetMath.hypot(player.x - book.x, player.y - book.y) <=
  PLAYER_RADIUS + SHELF_RULES.reachPx

export const swingShelf = (world: World): World => {
  if (!Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)) {
    return world
  }
  const level = levelOf(world)
  if (!isShelfShut(level)) {
    return world
  }
  return Option.match(secretShelfOf(level), {
    onNone: () => world,
    onSome: ({ book, tile }) =>
      Array.some(
        playersOf(world),
        ({ seat, player }) => isStanding(seat) && isAtBook(book, player),
      )
        ? UiStruct.evolve(world, {
            level: state => openExitIn(state, SECRET_EXIT),
            frameEvents: frameEvents => [
              ...frameEvents,
              GameEvent.ShelfSwung({
                x: book.x,
                y: (tile.row + 1) * TILE_SIZE,
              }),
            ],
          })
        : world,
  })
}
