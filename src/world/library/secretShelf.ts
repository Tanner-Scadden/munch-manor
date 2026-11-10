import { Array, Option, Order } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS, TILE_SIZE } from '../../shared/constants'
import {
  type Level,
  type Tile,
  levelOf,
  maybeExit,
  openExitIn,
} from '../level/arena'
import { LIBRARY_ROOM_ID, SECRET_EXIT, type Side } from '../level/plan'
import { isStanding, playersOf } from '../party/party'
import type { World } from '../schema/world'
import { GameEvent, Phase, type Vector } from '../schema/worldSchema'

// The library's twist (docs/ROOM_DRAFTS.md): one red book on the shelf in
// the wall it shares with the room it is entered from sticks out and
// glints. A player who walks up to it in a round pulls it, and the whole
// shelf swings open: the secret exit opens for the rest of the run, a free
// second way between the two rooms that zombies use too. Walking into the
// book is the trigger (no key, no hold, the same on touch), so the glint
// is the whole lesson. The shelf is the level's Secret exit (an exit whose
// opener is the shelf, never for sale), so once it is open its tiles are
// floor for every walker, bullet, and path with no rule of their own.

type ShelfRules = Readonly<{ reachPx: number; bookOutPx: number }>

// NOTE: the book sticks out of the shelf's face 2 px into the room, 7 px
// down from the top of its two wall tiles (src/render/room/libraryArt.ts).
export const SHELF_RULES: ShelfRules = { reachPx: 4, bookOutPx: 2 }

const BOOK_DOWN_PX = 7

// NOTE: where the shelf stands: the top of its two tiles in the library's
// wall, the wall it is in, and the book's spot.
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

// NOTE: a level keeps its shelf, so a frame only reads it.
export const secretShelfOf = (level: Level): Option.Option<SecretShelf> => {
  const cached = shelves.get(level)
  if (cached !== undefined) {
    return cached
  }
  const shelf = shelfIn(level)
  shelves.set(level, shelf)
  return shelf
}

// NOTE: the shelf can swing once the library is open and while it is shut.
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
  Math.hypot(player.x - book.x, player.y - book.y) <=
  PLAYER_RADIUS + SHELF_RULES.reachPx

// NOTE: a standing player at the book in a round swings the shelf open.
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
        ? modifyFields(world, {
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
