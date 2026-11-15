// The house in 3D, built once per level: the walls as ink-outlined blocks,
// the room's art on the floor less the furniture that stands up, the ferns
// cut into clumps for the wind, and the hidden stand-ins the furniture's
// shadows are cast through.

import { Array, Option, Record, Result, String, pipe } from 'effect'
import type { Canvas } from 'foldkit'
import { type Application, Graphics, Rectangle } from 'pixi.js'

import {
  type Container3D,
  CubeGeometry,
  type FlatMaterial,
  Geometry3D,
  Material3D,
  Mesh3D,
} from '@pixi/3d'
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
import { type BillboardPool, type Cutout, standCutout } from './billboards'
import type { ViewBox } from './cull'
import { type Leaf, flatten, rectKey } from './flatten'
import { LINTEL_FLOOR, lintelTilesOf } from './lintels'
import { STRETCH, UNIT, wallHeightAt, zOf } from './space'
import { colorOf } from './textures'
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
      const height = wallHeightAt({ tiles: level.tiles, row, column })
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

// NOTE: every wall tile's top as one mesh, wearing the room's art as the 2D
// game drew it from above: the wallpaper, the trim, the portraits. Each top
// is a quad over its tile, its texture coordinates on the floor's own
// picture of the level, so a game pixel on a wall's top is the same size as
// one on the floor and the art repaints with it. The block below stays the
// plain toon wall that gives it its height (owner, 2026-11-14: the walls
// were grey blobs).
export const buildWallTops = (
  input: Readonly<{ level: Level; material: Material3D }>,
): Mesh3D => {
  const { level, material } = input
  const tiles = Array.flatMap(level.tiles, (line, row) =>
    Array.filterMap(Array.fromIterable(line), (symbol, column) =>
      symbol === WALL_SYMBOL
        ? Result.succeed({
            row,
            column,
            y: wallHeightAt({ tiles: level.tiles, row, column }) + TOP_LIFT,
          })
        : Result.failVoid,
    ),
  )
  return buildTileQuads({
    level,
    material,
    tiles: [...tiles, ...lintelTopsOf(level)],
  })
}

// NOTE: a tile of the level by its row and column, and the height its quad
// lies at. It wears the picture over its own tile, or over `art`'s.
export type TileQuad = Readonly<{
  row: number
  column: number
  y: number
  art?: Readonly<{ row: number; column: number }>
}>

// NOTE: a flat quad over each tile, its texture coordinates on a picture of
// the whole level, one texel a game pixel from its top left corner.
export const buildTileQuads = (
  input: Readonly<{
    level: Level
    material: Material3D | FlatMaterial
    tiles: ReadonlyArray<TileQuad>
  }>,
): Mesh3D => {
  const { level, material, tiles } = input
  const positions = new Float32Array(tiles.length * 12)
  const normals = new Float32Array(tiles.length * 12)
  const uvs = new Float32Array(tiles.length * 8)
  const indices = new Uint32Array(tiles.length * 6)
  Array.forEach(tiles, ({ row, column, y, art }, index) => {
    const left = column * TILE_SIZE
    const top = row * TILE_SIZE
    const x0 = (level.left + left) * UNIT
    const x1 = x0 + TILE_SIZE * UNIT
    const z0 = zOf(level.top + top)
    const z1 = zOf(level.top + top + TILE_SIZE)
    const artLeft = (art?.column ?? column) * TILE_SIZE
    const artTop = (art?.row ?? row) * TILE_SIZE
    const u0 = artLeft / level.width
    const u1 = (artLeft + TILE_SIZE) / level.width
    // NOTE: the picture is rendered to its texture upside down, so its rows
    // count up from the bottom.
    const v0 = 1 - artTop / level.height
    const v1 = 1 - (artTop + TILE_SIZE) / level.height
    positions.set([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], index * 12)
    normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], index * 12)
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], index * 8)
    const first = index * 4
    indices.set(
      [first, first + 2, first + 1, first, first + 3, first + 2],
      index * 6,
    )
  })
  return new Mesh3D({
    geometry: new Geometry3D({ positions, normals, uvs, indices }),
    material,
    castShadow: false,
    receiveShadow: true,
  })
}

// NOTE: just over the block's own top, so the two never fight.
const TOP_LIFT = 0.002

// DOORWAYS

// NOTE: a block over each tile a lintel spans (lintels.ts), from the
// lintel's floor to the wall's top, so a doorway reads as cut through the
// wall rather than a gap in it. Its top wears the wall's art beside it
// (`lintelTopsOf`).
export const buildLintels = (
  input: Readonly<{ level: Level; material: ToonMaterial }>,
): ReadonlyArray<Mesh3D> => {
  const { level, material } = input
  return Array.map(lintelTilesOf(level), ({ row, column, height }) => {
    const x = (level.left + column * TILE_SIZE) * UNIT + 0.5
    const z = zOf(level.top + (row + 0.5) * TILE_SIZE)
    const tall = height - LINTEL_FLOOR
    return new Mesh3D({
      geometry: WALL_GEOMETRY,
      material,
      position: { x, y: LINTEL_FLOOR + tall / 2, z },
      scale: { x: 1, y: tall, z: STRETCH },
      castShadow: true,
      receiveShadow: true,
    })
  })
}

const lintelTopsOf = (level: Level): ReadonlyArray<TileQuad> =>
  Array.map(lintelTilesOf(level), ({ row, column, height, art }) => ({
    row,
    column,
    y: height + TOP_LIFT,
    art,
  }))

// WALL FACES

// NOTE: the rows at the foot of a wall tile's art that its face wears: the
// wainscot and the skirting the 2D game drew at the bottom of a top wall.
const FACE_ART_PX = 6
// NOTE: just in front of the block's own face, so the two never fight.
const FACE_LIFT = 0.003

type FaceQuad = Readonly<{
  row: number
  column: number
  bottom: number
  top: number
  art: Readonly<{ row: number; column: number }>
}>

const isWallTile = (
  tiles: ReadonlyArray<string>,
  row: number,
  column: number,
) =>
  Option.exists(
    String.charAt(tiles[row] ?? '', column),
    symbol => symbol === WALL_SYMBOL,
  )

// NOTE: every wall face the lens sees: a wall tile's south side over floor,
// from the floor to its top, and a lintel's from its floor to its top.
const wallFacesOf = (level: Level): ReadonlyArray<FaceQuad> => [
  ...Array.flatMap(level.tiles, (line, row) =>
    Array.filterMap(Array.fromIterable(line), (symbol, column) =>
      symbol === WALL_SYMBOL && !isWallTile(level.tiles, row + 1, column)
        ? Result.succeed({
            row,
            column,
            bottom: 0,
            top: wallHeightAt({ tiles: level.tiles, row, column }),
            art: { row, column },
          })
        : Result.failVoid,
    ),
  ),
  ...Array.map(lintelTilesOf(level), ({ row, column, height, art }) => ({
    row,
    column,
    bottom: LINTEL_FLOOR,
    top: height,
    art,
  })),
]

// NOTE: every wall's south face as one mesh, wearing the foot of its own
// art stretched down it, so the 2D game's wainscot runs down to the floor
// instead of a plain grey band under every wall.
export const buildWallFaces = (
  input: Readonly<{ level: Level; material: Material3D }>,
): Mesh3D => {
  const { level, material } = input
  const faces = wallFacesOf(level)
  const positions = new Float32Array(faces.length * 12)
  const normals = new Float32Array(faces.length * 12)
  const uvs = new Float32Array(faces.length * 8)
  const indices = new Uint32Array(faces.length * 6)
  Array.forEach(faces, ({ row, column, bottom, top, art }, index) => {
    const x0 = (level.left + column * TILE_SIZE) * UNIT
    const x1 = x0 + TILE_SIZE * UNIT
    const z = zOf(level.top + (row + 1) * TILE_SIZE) + FACE_LIFT
    const u0 = (art.column * TILE_SIZE) / level.width
    const u1 = ((art.column + 1) * TILE_SIZE) / level.width
    // NOTE: the picture is upside down in its texture (buildTileQuads).
    const foot = (art.row + 1) * TILE_SIZE
    const vTop = 1 - (foot - FACE_ART_PX) / level.height
    const vFoot = 1 - foot / level.height
    positions.set(
      [x0, top, z, x1, top, z, x1, bottom, z, x0, bottom, z],
      index * 12,
    )
    normals.set([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], index * 12)
    uvs.set([u0, vTop, u1, vTop, u1, vFoot, u0, vFoot], index * 8)
    const first = index * 4
    indices.set(
      [first, first + 2, first + 1, first, first + 3, first + 2],
      index * 6,
    )
  })
  return new Mesh3D({
    geometry: new Geometry3D({ positions, normals, uvs, indices }),
    material,
    castShadow: false,
    receiveShadow: true,
  })
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
  'Hearth',
  'Oven',
  'Fridge',
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

// THE FERNS' SHADOWS

// NOTE: a shadow stand-in and the box on the game's map it stands over, so
// the scene can leave it out while it lies far off screen.
export type Caster = Readonly<{ mesh: Mesh3D; box: ViewBox }>

// NOTE: a fern turns to the lens and bends in the wind, so it casts through
// a stand-in: the whole fern baked into one texture (`plantsOf`) and cut out
// upright on a plain mesh at its foot. Furniture is carved and casts
// through its own blocks (voxels.ts).
export const plantCastersOf = (
  input: Readonly<{ parent: Container3D; plants: ReadonlyArray<Plant> }>,
): ReadonlyArray<Caster> =>
  Array.map(input.plants, ({ caster }) => ({
    mesh: standCutout({
      parent: input.parent,
      material: new Material3D({
        baseColorTexture: caster.texture,
        alphaMode: 'mask',
        alphaCutoff: 0.5,
        doubleSided: true,
      }),
      cutout: caster,
    }),
    box: cutoutBoxOf(caster),
  }))

// NOTE: where a cutout stands on the game's map, in game pixels.
export const cutoutBoxOf = (cutout: Cutout): ViewBox => ({
  left: cutout.left,
  top: cutout.top,
  right: cutout.left + cutout.width,
  bottom: Math.max(cutout.top + cutout.height, cutout.footY),
})
