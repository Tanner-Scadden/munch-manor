import { Array, Function, Option, Record, Result, pipe } from 'effect'

import { bakeShapes, deepSprite, group, placeAt } from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import { SECRET_EXIT } from '../../world/level/plan'
import { COVER_SYMBOLS, type CoverKind } from '../../world/level/tileGrid'
import { secretShelfOf } from '../../world/library/secretShelf'
import type { Player, Zombie } from '../../world/schema/entitySchema'
import type { Drawable } from '../depth'
import type * as Draw from '../draw'
import { playerFootY } from '../playerView'
import { zombieFootY } from '../zombieGroundView'
import { ESCAPE_COVER_DRAWINGS, isEscapeCoverKind } from './escapeCover'
import {
  SHELF_CASE_HEIGHT,
  SHELF_CASE_LENGTH,
  SWUNG_SHELF_FOOT_PX,
  SWUNG_SHELF_SPRITES,
} from './libraryArt'
import { COVER_DRAWINGS, coverBlocks } from './roomCover'

// NOTE: the room image is baked flat on the floor canvas, under everyone, so
// a tall piece of furniture there could never hide someone standing behind
// it. Each tall piece gets its own image of its art, drawn in the depth sort
// at its foot, but only while someone stands behind it: it paints the same
// pixels the floor already has, so it hides them as the furniture should.
// While a player is behind one, or a zombie close to a player, it fades, so
// nobody loses themselves or a threat behind a china cabinet or a stack.

// NOTE: the kinds whose art rises a body's height or so above the floor
// they stand on.
const TALL_KINDS: ReadonlyArray<CoverKind> = [
  'Piano',
  'Bookshelf',
  'Pantry',
  'PartyTable',
  'Hutch',
  'Candelabra',
  'BookStack',
  'Desk',
  'WineRack',
  'Hearth',
  'Oven',
  'Fridge',
]

// NOTE: the pieces against a wall whose art is their front, standing
// upright on their own tiles, a box as deep as the tiles go, so they read
// as standing against the wall and nobody looks for a way behind them: the
// cabinets, shelves, and racks, and the hearth, stove, and fridge. What is
// drawn on one every frame (the hearth's fire, the stove's window, the
// fridge's door) stands upright on its front (`ON_FRONT_PX`). The others
// lean square to the pitch as every sprite does: a library stack's art is
// its whole length seen from the room, which its lean already lays over
// its tiles.
const UPRIGHT_KINDS: ReadonlyArray<CoverKind> = [
  'Piano',
  'Bookshelf',
  'Pantry',
  'Hutch',
  'WineRack',
  'Hearth',
  'Oven',
  'Fridge',
]

export type TallCover = Readonly<{
  left: number
  right: number
  artTop: number
  footY: number
  shapes: ReadonlyArray<Draw.Shape>
}>

const drawingOf = (
  kind: CoverKind,
): ((
  box: Readonly<{ x: number; y: number; width: number; height: number }>,
  level: Level,
) => ReadonlyArray<Draw.Shape>) =>
  isEscapeCoverKind(kind) ? ESCAPE_COVER_DRAWINGS[kind] : COVER_DRAWINGS[kind]

// NOTE: a faint glow on the floor around a piece (a candle's, a
// candelabra's) has nothing solid under it in the piece's own image, so it
// would paint a second time over the floor's. The image leaves it out.
const GLOW_ALPHA = 0.2

const alphaOf = (fill: string): number =>
  pipe(
    Option.fromNullishOr(/^rgba\([^)]*,\s*([\d.]+)\)$/.exec(fill)),
    Option.flatMap(match => Array.get(match, 1)),
    Option.map(Number),
    Option.getOrElse(() => 1),
  )

const isGlow = (shape: Draw.Shape): boolean =>
  shape._tag === 'Rect' && alphaOf(shape.fill ?? '') < GLOW_ALPHA

const boundsOf = (
  shapes: ReadonlyArray<Draw.Shape>,
): Option.Option<Readonly<{ left: number; top: number; right: number }>> =>
  Array.reduce(
    shapes,
    Option.none<Readonly<{ left: number; top: number; right: number }>>(),
    (bounds, shape) =>
      shape._tag === 'Rect'
        ? Option.some(
            Option.match(bounds, {
              onNone: () => ({
                left: shape.x,
                top: shape.y,
                right: shape.x + shape.width,
              }),
              onSome: ({ left, top, right }) => ({
                left: Math.min(left, shape.x),
                top: Math.min(top, shape.y),
                right: Math.max(right, shape.x + shape.width),
              }),
            }),
          )
        : bounds,
  )

const tallCoverOfKind = (
  level: Level,
  symbol: string,
  kind: CoverKind,
): ReadonlyArray<TallCover> => {
  const isUpright = Array.contains(UPRIGHT_KINDS, kind)
  return Array.filterMap(coverBlocks(level, symbol), box => {
    const art = Array.filter(
      drawingOf(kind)(box, level),
      shape => !isGlow(shape),
    )
    return Option.match(boundsOf(art), {
      onNone: () => Result.failVoid,
      onSome: ({ left, top, right }) =>
        Result.succeed({
          left,
          right,
          artTop: top,
          footY: box.y + box.height,
          shapes: isUpright
            ? deepSprite(bakeShapes(art), {
                most: box.height,
                isUpright: true,
              })
            : bakeShapes(art),
        }),
    })
  })
}

// NOTE: the library's secret shelf swung open stands across the floor as
// a piece of furniture does (src/render/room/libraryArt.ts), drawn as if in
// the west wall from the shelf's tile and flipped for the east.
const swungShelfOf = (level: Level): ReadonlyArray<TallCover> =>
  Array.contains(level.openExits, SECRET_EXIT)
    ? Option.match(secretShelfOf(level), {
        onNone: () => [],
        onSome: ({ tile, side }) => {
          const x = tile.column * TILE_SIZE
          const y = tile.row * TILE_SIZE
          const [left, right] =
            side === 'West'
              ? [x + TILE_SIZE, x + TILE_SIZE + SHELF_CASE_LENGTH]
              : [x - SHELF_CASE_LENGTH, x]
          return [
            {
              left,
              right,
              artTop: y + SWUNG_SHELF_FOOT_PX - SHELF_CASE_HEIGHT,
              footY: y + SWUNG_SHELF_FOOT_PX,
              shapes: [placeAt(x, y, SWUNG_SHELF_SPRITES[side])],
            },
          ]
        },
      })
    : []

const builtTallCover = new WeakMap<Level, ReadonlyArray<TallCover>>()

// NOTE: built once for each level and kept, like the room images. The
// images depend only on the map's cover, so every level of one spec bakes
// the same ones, and src/art/spritePrecompile.ts builds them for the atlas.
export const tallCoverOf = (level: Level): ReadonlyArray<TallCover> => {
  const cached = builtTallCover.get(level)
  if (cached !== undefined) {
    return cached
  }
  const pieces = pipe(
    Record.toEntries(COVER_SYMBOLS),
    // NOTE: a few cover kinds, once a level (cached).
    // oxlint-disable-next-line munch/no-nested-scan
    Array.filter(([, kind]) => Array.contains(TALL_KINDS, kind)),
    Array.flatMap(([symbol, kind]) => tallCoverOfKind(level, symbol, kind)),
    Array.appendAll(swungShelfOf(level)),
  )
  builtTallCover.set(level, pieces)
  return pieces
}

// BEHIND

// NOTE: about the width of a player's or a Groaner's body either side of
// their middle.
const BODY_HALF_PX = 7
// NOTE: a zombie this close to a player shows through what it is behind.
const REVEAL_PX = 96
// NOTE: the fade deepens as the body goes behind, over these many pixels
// down and across, so it follows a step in and out with no clock.
const FADE_DEPTH_PX = 8
const FADE_ACROSS_PX = 6
// NOTE: a body just grazing a piece's side does not fade it.
const GRAZE_PX = 2
const MIN_OPACITY = 0.4
const NOT_BEHIND = -1
// NOTE: how far a zombie's middle can sit from its feet, Uncle Chunk's
// included, with room to spare: a zombie farther than this from a piece's
// span is not behind it, and its feet are never worked out.
const NEAR_PX = 48

// NOTE: past this from every player a piece is off the screen, so it is
// not checked at all: the scene's zombies are the ones on camera.
const SCREEN_X_PX = 240
const SCREEN_Y_PX = 160

const isOnScreen = (
  piece: TallCover,
  players: ReadonlyArray<Player>,
): boolean =>
  Array.some(
    players,
    ({ x, y }) =>
      x > piece.left - SCREEN_X_PX &&
      x < piece.right + SCREEN_X_PX &&
      y > piece.artTop - SCREEN_Y_PX &&
      y < piece.footY + SCREEN_Y_PX,
  )

const clampUnit = (value: number): number => Math.min(1, Math.max(0, value))

// NOTE: how far a body is behind a piece, from 0 (just) to 1 (well in), or
// NOT_BEHIND when its feet are in front of it or its body clears the art.
// It runs for every piece and body each frame, so it is plain arithmetic.
const behindness = (piece: TallCover, x: number, footY: number): number => {
  if (footY >= piece.footY || footY <= piece.artTop) {
    return NOT_BEHIND
  }
  const across =
    Math.min(x + BODY_HALF_PX, piece.right) -
    Math.max(x - BODY_HALF_PX, piece.left)
  return across > 0
    ? clampUnit((footY - piece.artTop) / FADE_DEPTH_PX) *
        clampUnit((across - GRAZE_PX) / FADE_ACROSS_PX)
    : NOT_BEHIND
}

const isNearPiece = (piece: TallCover, { x, y }: Zombie): boolean =>
  x > piece.left - NEAR_PX &&
  x < piece.right + NEAR_PX &&
  y > piece.artTop - NEAR_PX &&
  y < piece.footY + NEAR_PX

const isNearAny = (players: ReadonlyArray<Player>, zombie: Zombie): boolean =>
  Array.some(
    players,
    player => Math.hypot(player.x - zombie.x, player.y - zombie.y) < REVEAL_PX,
  )

// NOTE: how far the piece fades: by the deepest player behind it, or a
// zombie behind it near a player. A zombie behind it far from everyone
// only makes it draw, unfaded: NOT_BEHIND when nobody is behind it.
const fadeOf = (
  piece: TallCover,
  players: ReadonlyArray<Player>,
  zombies: ReadonlyArray<Zombie>,
): number =>
  Array.reduce(
    zombies,
    Array.reduce(players, NOT_BEHIND, (most, player) =>
      Math.max(most, behindness(piece, player.x, playerFootY(player))),
    ),
    (most, zombie) => {
      if (!isNearPiece(piece, zombie)) {
        return most
      }
      const depth = behindness(piece, zombie.x, zombieFootY(zombie))
      return depth <= most
        ? most
        : isNearAny(players, zombie)
          ? depth
          : Math.max(most, 0)
    },
  )

// NOTE: the tall pieces someone stands behind, each at its foot in the depth
// sort, faded for whoever should show through it: the players always, the
// zombies only near a player, so a threat is never lost behind a cabinet.
export const tallCoverDrawables: {
  (
    players: ReadonlyArray<Player>,
    zombies: ReadonlyArray<Zombie>,
  ): (level: Level) => ReadonlyArray<Drawable>
  (
    level: Level,
    players: ReadonlyArray<Player>,
    zombies: ReadonlyArray<Zombie>,
  ): ReadonlyArray<Drawable>
} = Function.dual(
  3,
  (
    level: Level,
    players: ReadonlyArray<Player>,
    zombies: ReadonlyArray<Zombie>,
  ): ReadonlyArray<Drawable> =>
    Array.filterMap(tallCoverOf(level), piece => {
      const fade = isOnScreen(piece, players)
        ? fadeOf(piece, players, zombies)
        : NOT_BEHIND
      if (fade === NOT_BEHIND) {
        return Result.failVoid
      }
      const opacity = 1 - (1 - MIN_OPACITY) * fade
      return Result.succeed({
        footY: piece.footY,
        rank: 'Prop',
        shapes:
          opacity >= 1
            ? piece.shapes
            : [group({ shapes: piece.shapes, opacity })],
      })
    }),
)
