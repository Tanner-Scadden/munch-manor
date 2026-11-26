import { Array, Function, Option, Record, Result, pipe } from 'effect'

import { bakeShapes, deepSprite, group, placeAt } from '#art/sprite.ts'
import type { Drawable } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import { playerFootY } from '#render/playerView.ts'
import { zombieFootY } from '#render/zombieGroundView.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import type { Level } from '#world/level/arena.ts'
import { SECRET_EXIT } from '#world/level/plan.ts'
import { COVER_SYMBOLS, type CoverKind } from '#world/level/tileGrid.ts'
import { secretShelfOf } from '#world/library/secretShelf.ts'
import type { Player, Zombie } from '#world/schema/entitySchema.ts'

import { ESCAPE_COVER_DRAWINGS, isEscapeCoverKind } from './escapeCover.ts'
import {
  SHELF_CASE_HEIGHT,
  SHELF_CASE_LENGTH,
  SWUNG_SHELF_FOOT_PX,
  SWUNG_SHELF_SPRITES,
} from './libraryArt.ts'
import { COVER_DRAWINGS, coverBlocks } from './roomCover.ts'

const TALL_KINDS: ReadonlySet<CoverKind> = new Set<CoverKind>([
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
])

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

const TALL_SYMBOLS = Array.filter(Record.toEntries(COVER_SYMBOLS), ([, kind]) =>
  TALL_KINDS.has(kind),
)

const builtTallCover = new WeakMap<Level, ReadonlyArray<TallCover>>()

export const tallCoverOf = (level: Level): ReadonlyArray<TallCover> => {
  const cached = builtTallCover.get(level)
  if (cached !== undefined) {
    return cached
  }
  const pieces = pipe(
    TALL_SYMBOLS,
    Array.flatMap(([symbol, kind]) => tallCoverOfKind(level, symbol, kind)),
    Array.appendAll(swungShelfOf(level)),
  )
  builtTallCover.set(level, pieces)
  return pieces
}

const BODY_HALF_PX = 7
const REVEAL_PX = 96
const FADE_DEPTH_PX = 8
const FADE_ACROSS_PX = 6
const GRAZE_PX = 2
const MIN_OPACITY = 0.4
const NOT_BEHIND = -1
const NEAR_PX = 48

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
