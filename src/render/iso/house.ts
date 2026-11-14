// The house in 3D, built once per level: the walls as ink-outlined blocks,
// the room's art on the floor less the furniture that stands up, the ferns
// cut into clumps for the wind, and the hidden stand-ins the furniture's
// shadows are cast through.

import { Array, Option, Record, Result, pipe } from 'effect'
import type { Canvas } from 'foldkit'
import { type Application, Container, Graphics, Rectangle } from 'pixi.js'

import { type Container3D, CubeGeometry, Material3D, Mesh3D } from '@pixi/3d'
import type { ToonMaterial } from '@pixi/3d/extras'

import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import {
  COVER_SYMBOLS,
  type CoverKind,
  WALL_SYMBOL,
} from '../../world/level/tileGrid'
import { ESCAPE_COVER_DRAWINGS, isEscapeCoverKind } from '../room/escapeCover'
import { roomArtOf } from '../room/room'
import { COVER_DRAWINGS, coverBlocks } from '../room/roomCover'
import type { TallCover } from '../room/tallCover'
import {
  type BillboardPool,
  type Cutout,
  drawnLeafOf,
  standCutout,
} from './billboards'
import { type Leaf, flatten, rectKey } from './flatten'
import { FlatPainter } from './painter'
import {
  FRONT_WALL_HEIGHT,
  STRETCH,
  UNIT,
  WALL_HEIGHT,
  isFrontWallAt,
  zOf,
} from './space'
import { type Textures, colorOf } from './textures'
import { type Bounds, bendWeightOf, fernBandOf, windOffsetAt } from './wind'

// WALLS

const WALL_GEOMETRY = new CubeGeometry({ width: 1, height: 1, depth: 1 })

export const buildWalls = (
  input: Readonly<{ level: Level; material: ToonMaterial }>,
): ReadonlyArray<Mesh3D> => {
  const { level, material } = input
  return Array.flatMap(level.tiles, (line, row) =>
    Array.filterMap(Array.fromIterable(line), (symbol, column) => {
      if (symbol !== WALL_SYMBOL) {
        return Result.failVoid
      }
      const x = (level.left + column * TILE_SIZE) * UNIT + 0.5
      const z = zOf(level.top + (row + 0.5) * TILE_SIZE)
      const height = isFrontWallAt({ tiles: level.tiles, row, column })
        ? FRONT_WALL_HEIGHT
        : WALL_HEIGHT
      return Result.succeed(
        new Mesh3D({
          geometry: WALL_GEOMETRY,
          material,
          position: { x, y: height / 2, z },
          scale: { x: 1, y: height, z: STRETCH },
          castShadow: true,
          receiveShadow: true,
        }),
      )
    }),
  )
}

// FURNITURE

// NOTE: the kinds the game draws over whoever stands behind them
// (src/render/room/tallCover.ts), and the ferns, which sway. In 3D they
// leave the floor and stand up for good, so nothing pops in or out.
const STANDING_KINDS: ReadonlySet<CoverKind> = new Set<CoverKind>([
  'Piano',
  'Bookshelf',
  'Pantry',
  'PartyTable',
  'Hutch',
  'Candelabra',
  'BookStack',
  'Desk',
  'WineRack',
  'Fern',
])

const FERN_SYMBOL = 'V'

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const drawingOf = (
  kind: CoverKind,
): ((box: Box, level: Level) => ReadonlyArray<Canvas.Shape>) =>
  isEscapeCoverKind(kind) ? ESCAPE_COVER_DRAWINGS[kind] : COVER_DRAWINGS[kind]

const FAINT_FILL = /^rgba\([^)]*,\s*([\d.]+)\)$/

const isFaint = (fill: string | undefined): boolean =>
  Option.exists(
    Option.fromNullishOr(FAINT_FILL.exec(fill ?? '')),
    match => Number(match[1]) < 0.2,
  )

// NOTE: the room's art with every standing piece taken out, rect by rect:
// the pieces' own drawings give the rects to leave out (their faint floor
// glows stay on the floor).
export const floorArtOf = (level: Level): ReadonlyArray<Leaf> => {
  const lifted = new Set<string>()
  for (const [symbol, kind] of Record.toEntries(COVER_SYMBOLS)) {
    if (STANDING_KINDS.has(kind)) {
      for (const box of coverBlocks(level, symbol)) {
        for (const { shape } of flatten(drawingOf(kind)(box, level))) {
          if (shape._tag === 'Rect' && !isFaint(shape.fill)) {
            lifted.add(rectKey(shape))
          }
        }
      }
    }
  }
  return Array.filter(
    flatten(roomArtOf(level)),
    ({ shape }) => shape._tag !== 'Rect' || !lifted.has(rectKey(shape)),
  )
}

// PLANTS

type Clump = Readonly<{
  texture: Cutout['texture']
  left: number
  top: number
  width: number
  height: number
  weight: number
}>

export type Plant = Readonly<{
  footY: number
  spot: Readonly<{ x: number; y: number }>
  clumps: ReadonlyArray<Clump>
  // NOTE: the whole fern in one texture, for its shadow, which stays still.
  caster: Cutout
}>

const boundsOf = (rects: ReadonlyArray<Canvas.Rect>): Bounds =>
  Array.reduce(
    rects,
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
    (bounds, rect) => ({
      left: Math.min(bounds.left, rect.x),
      top: Math.min(bounds.top, rect.y),
      right: Math.max(bounds.right, rect.x + rect.width),
      bottom: Math.max(bounds.bottom, rect.y + rect.height),
    }),
  )

const bakeRects = (
  app: Application,
  rects: ReadonlyArray<Canvas.Rect>,
  bounds: Bounds,
): Cutout['texture'] => {
  const graphics = new Graphics()
  for (const rect of rects) {
    const { color, alpha } = colorOf(rect.fill ?? '#000')
    graphics
      .rect(rect.x - bounds.left, rect.y - bounds.top, rect.width, rect.height)
      .fill({ color, alpha })
  }
  const texture = app.renderer.generateTexture({
    target: graphics,
    frame: new Rectangle(
      0,
      0,
      bounds.right - bounds.left,
      bounds.bottom - bounds.top,
    ),
    resolution: 1,
  })
  texture.source.scaleMode = 'nearest'
  graphics.destroy()
  return texture
}

export const plantsOf = (
  input: Readonly<{ app: Application; level: Level }>,
): ReadonlyArray<Plant> => {
  const { app, level } = input
  return Array.map(coverBlocks(level, FERN_SYMBOL), box => {
    const rects = Array.filterMap(
      flatten(COVER_DRAWINGS.Fern(box, level)),
      ({ shape }) =>
        shape._tag === 'Rect' ? Result.succeed(shape) : Result.failVoid,
    )
    const plant = boundsOf(rects)
    const clumps = pipe(
      Array.groupBy(rects, rect => fernBandOf({ rect, plant })),
      Record.toEntries,
      Array.map(([key, members]): Clump => {
        const bounds = boundsOf(members)
        return {
          texture: bakeRects(app, members, bounds),
          left: bounds.left,
          top: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
          weight: bendWeightOf({
            band: key,
            top: bounds.top - plant.top,
            height: bounds.bottom - bounds.top,
          }),
        }
      }),
    )
    return {
      footY: plant.bottom,
      spot: { x: plant.left, y: plant.top },
      clumps,
      caster: {
        texture: bakeRects(app, rects, plant),
        left: plant.left,
        top: plant.top,
        width: plant.right - plant.left,
        height: plant.bottom - plant.top,
        footY: plant.bottom,
      },
    }
  })
}

export const standPlant = (
  input: Readonly<{ pool: BillboardPool; plant: Plant; t: number }>,
): void => {
  const { pool, plant, t } = input
  Array.forEach(plant.clumps, (clump, part) => {
    const sway = windOffsetAt({ t, spot: plant.spot, weight: clump.weight })
    pool.place({
      texture: clump.texture,
      centerX: clump.left + clump.width / 2 + sway.x,
      // NOTE: sideways only: bands that rose and fell apart would open a
      // pixel's gap between their rows.
      bottom: clump.top + clump.height,
      drawnWidth: clump.width,
      drawnHeight: clump.height,
      footY: plant.footY,
      hover: 0,
      tint: 0xffffff,
      alpha: 1,
      part,
    })
  })
}

// FURNITURE'S SHADOWS

const bakePiece = (
  input: Readonly<{ app: Application; textures: Textures; piece: TallCover }>,
): Option.Option<Cutout> => {
  const { app, textures, piece } = input
  const drawn = Array.filter(
    Array.filterMap(flatten(piece.shapes), leaf =>
      Result.fromNullishOr(drawnLeafOf({ textures, leaf }), () => undefined),
    ),
    ({ alpha }) => alpha >= 0.5,
  )
  if (!Array.isReadonlyArrayNonEmpty(drawn)) {
    return Option.none()
  }
  const bounds = Array.reduce(
    drawn,
    {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    },
    (most, one) => ({
      left: Math.min(most.left, one.centerX - one.drawnWidth / 2),
      top: Math.min(most.top, one.bottom - one.drawnHeight),
      right: Math.max(most.right, one.centerX + one.drawnWidth / 2),
      bottom: Math.max(most.bottom, one.bottom),
    }),
  )
  const painter = new FlatPainter(textures)
  painter.paint(piece.shapes)
  painter.container.position.set(-bounds.left, -bounds.top)
  const holder = new Container()
  holder.addChild(painter.container)
  const texture = app.renderer.generateTexture({
    target: holder,
    frame: new Rectangle(
      0,
      0,
      Math.ceil(bounds.right - bounds.left),
      Math.ceil(bounds.bottom - bounds.top),
    ),
    resolution: 1,
  })
  holder.destroy({ children: true })
  return Option.some({
    texture,
    left: bounds.left,
    top: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
    footY: piece.footY,
  })
}

// NOTE: every tall piece and fern casts through a stand-in: its art baked
// into one texture and cut out upright on a plain mesh at its foot. Baked
// again whenever more images have loaded, so no piece is left without one.
export const furnitureCastersOf = (
  input: Readonly<{
    app: Application
    textures: Textures
    parent: Container3D
    pieces: ReadonlyArray<TallCover>
    plants: ReadonlyArray<Plant>
  }>,
): ReadonlyArray<Cutout['texture']> => {
  const { app, textures, parent, pieces, plants } = input
  const baked = Array.getSomes(
    Array.map(pieces, piece => bakePiece({ app, textures, piece })),
  )
  const cutouts: ReadonlyArray<Cutout> = [
    ...baked,
    ...Array.map(plants, ({ caster }) => caster),
  ]
  Array.forEach(cutouts, cutout => {
    standCutout({
      parent,
      material: new Material3D({
        baseColorTexture: cutout.texture,
        alphaMode: 'mask',
        alphaCutoff: 0.5,
        doubleSided: true,
      }),
      cutout,
    })
  })
  return Array.map(baked, ({ texture }) => texture)
}
