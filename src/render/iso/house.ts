import { Array, Option, Record, Result, pipe } from 'effect'
import { type Application, Graphics, Rectangle } from 'pixi.js'

import {
  type Container3D,
  CubeGeometry,
  FlatMaterial,
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
import type * as Draw from '../draw'
import { ESCAPE_COVER_DRAWINGS, isEscapeCoverKind } from '../room/escapeCover'
import { roomArtOf } from '../room/room'
import { COVER_DRAWINGS, coverBlocks } from '../room/roomCover'
import { type BillboardPool, type Cutout, standCutout } from './billboards'
import type { ViewBox } from './cull'
import { type Leaf, flatten, makeRectSet } from './flatten'
import { LINTEL_FLOOR, lintelTilesOf } from './lintels'
import { STRETCH, UNIT, wallHeightAt, zOf } from './space'
import { colorOf } from './textures'
import {
  type ArtQuad,
  BLOCK_INSET,
  NEAREST_SEAM,
  fannedBlocksOf,
  isFannedAt,
  standingTilesOf,
  wallQuadsOf,
} from './wallQuads'
import { type Bounds, bendWeightOf, fernBandOf, windOffsetAt } from './wind'

const WALL_GEOMETRY = new CubeGeometry({ width: 1, height: 1, depth: 1 })

export const buildWalls = (
  input: Readonly<{ level: Level; material: ToonMaterial }>,
): ReadonlyArray<Mesh3D> => {
  const { level, material } = input
  const tiles = standingTilesOf(level)
  return Array.flatMap(tiles, (line, row) =>
    Array.filterMap(Array.fromIterable(line), (symbol, column) => {
      if (symbol !== WALL_SYMBOL) {
        return Result.failVoid
      }
      const x = (level.left + column * TILE_SIZE) * UNIT + 0.5
      const z = zOf(level.top + (row + 0.5) * TILE_SIZE)
      const height = wallHeightAt({ tiles, row, column })
      const block = new Mesh3D({
        geometry: WALL_GEOMETRY,
        material,
        position: { x, y: height / 2, z },
        scale: {
          x: 1 - BLOCK_INSET * 2,
          y: height,
          z: STRETCH - BLOCK_INSET * 2,
        },
        castShadow: true,
        receiveShadow: true,
      })
      if (isFannedAt({ level, row, column })) {
        block.disablePass('opaque')
      }
      return Result.succeed(block)
    }),
  )
}

export class ArtMesh {
  readonly mesh: Mesh3D
  private readonly at: Uint32Array
  private readonly xs: Float64Array
  private readonly zs: Float64Array
  private readonly seams: Float64Array
  private eye: Option.Option<Readonly<{ x: number; z: number }>> = Option.none()

  constructor(mesh: Mesh3D, quads: ReadonlyArray<ArtQuad>) {
    this.mesh = mesh
    const fanned = Array.flatMap(quads, ({ corners, fan }, index) =>
      Option.match(fan, {
        onNone: () => [],
        onSome: ({ seam, corners: which }) =>
          Array.map(which, corner => {
            const [x, , z] = corners[corner] ?? [0, 0, 0]
            return { at: (index * 4 + corner) * 3, x, z, seam }
          }),
      }),
    )
    this.at = Uint32Array.from(fanned, ({ at }) => at)
    this.xs = Float64Array.from(fanned, ({ x }) => x)
    this.zs = Float64Array.from(fanned, ({ z }) => z)
    this.seams = Float64Array.from(fanned, ({ seam }) => seam)
  }

  fanFrom(eye: Option.Option<Readonly<{ x: number; z: number }>>): void {
    const isSame = Option.match(eye, {
      onNone: () => Option.isNone(this.eye),
      onSome: ({ x, z }) =>
        Option.exists(this.eye, last => last.x === x && last.z === z),
    })
    if (isSame || this.at.length === 0) {
      return
    }
    this.eye = Option.map(eye, ({ x, z }) => ({ x, z }))
    const { geometry } = this.mesh
    const positions = geometry.positions
    if (Option.isNone(eye)) {
      for (let index = 0; index < this.at.length; index += 1) {
        positions[this.at[index] ?? 0] = this.xs[index] ?? 0
      }
    } else {
      const { x: eyeX, z: eyeZ } = eye.value
      for (let index = 0; index < this.at.length; index += 1) {
        const x = this.xs[index] ?? 0
        const reach = eyeZ - (this.seams[index] ?? 0)
        positions[this.at[index] ?? 0] =
          reach < NEAREST_SEAM
            ? x
            : eyeX + ((x - eyeX) * (eyeZ - (this.zs[index] ?? 0))) / reach
      }
    }
    geometry.attributes['aPosition']?.buffer.update()
  }
}

export const buildArtQuads = (
  input: Readonly<{
    level: Level
    material: Material3D | FlatMaterial | ToonMaterial
    quads: ReadonlyArray<ArtQuad>
  }>,
): ArtMesh => {
  const { level, material, quads } = input
  const positions = new Float32Array(quads.length * 12)
  const normals = new Float32Array(quads.length * 12)
  const uvs = new Float32Array(quads.length * 8)
  const indices = new Uint32Array(quads.length * 6)
  Array.forEach(quads, ({ corners, art, shade }, index) => {
    positions.set(Array.flatten(corners), index * 12)
    normals.set([...shade, ...shade, ...shade, ...shade], index * 12)
    uvs.set(
      Array.flatMap(art, ([u, v]) => [u / level.width, 1 - v / level.height]),
      index * 8,
    )
    const first = index * 4
    indices.set(
      [first, first + 2, first + 1, first, first + 3, first + 2],
      index * 6,
    )
  })
  return new ArtMesh(
    new Mesh3D({
      geometry: new Geometry3D({ positions, normals, uvs, indices }),
      material,
      castShadow: false,
      receiveShadow: true,
    }),
    quads,
  )
}

export const buildWallArt = (
  input: Readonly<{ level: Level; material: Material3D }>,
): ArtMesh =>
  buildArtQuads({
    ...input,
    quads: Array.filter(
      wallQuadsOf(input.level),
      ({ wears }) => wears !== 'Night',
    ),
  })

export const buildFannedBlocks = (
  input: Readonly<{ level: Level; material: ToonMaterial }>,
): ArtMesh => buildArtQuads({ ...input, quads: fannedBlocksOf(input.level) })

export const buildWallDark = (level: Level): ArtMesh =>
  buildArtQuads({
    level,
    material: new FlatMaterial({ baseColor: 0x000000 }),
    quads: Array.filter(wallQuadsOf(level), ({ wears }) => wears === 'Night'),
  })

export type TileQuad = Readonly<{
  row: number
  column: number
  y: number
}>

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
  Array.forEach(tiles, ({ row, column, y }, index) => {
    const left = column * TILE_SIZE
    const top = row * TILE_SIZE
    const x0 = (level.left + left) * UNIT
    const x1 = x0 + TILE_SIZE * UNIT
    const z0 = zOf(level.top + top)
    const z1 = zOf(level.top + top + TILE_SIZE)
    const u0 = left / level.width
    const u1 = (left + TILE_SIZE) / level.width
    const v0 = 1 - top / level.height
    const v1 = 1 - (top + TILE_SIZE) / level.height
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
      scale: { x: 1 - BLOCK_INSET * 2, y: tall, z: STRETCH - BLOCK_INSET * 2 },
      castShadow: true,
      receiveShadow: true,
    })
  })
}

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
): ((box: Box, level: Level) => ReadonlyArray<Draw.Shape>) =>
  isEscapeCoverKind(kind) ? ESCAPE_COVER_DRAWINGS[kind] : COVER_DRAWINGS[kind]

const FAINT_FILL = /^rgba\([^)]*,\s*([\d.]+)\)$/

const isFaint = (fill: string | undefined): boolean =>
  Option.exists(
    Option.fromNullishOr(FAINT_FILL.exec(fill ?? '')),
    match => Number(match[1]) < 0.2,
  )

export const floorArtOf = (level: Level): ReadonlyArray<Leaf> => {
  const lifted = makeRectSet()
  for (const [symbol, kind] of Record.toEntries(COVER_SYMBOLS)) {
    if (STANDING_KINDS.has(kind)) {
      for (const box of coverBlocks(level, symbol)) {
        for (const { shape } of flatten(drawingOf(kind)(box, level))) {
          if (shape._tag === 'Rect' && !isFaint(shape.fill)) {
            lifted.add(shape)
          }
        }
      }
    }
  }
  return Array.filter(
    flatten(roomArtOf(level)),
    ({ shape }) => shape._tag !== 'Rect' || !lifted.has(shape),
  )
}

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
  caster: Cutout
}>

const boundsOf = (rects: ReadonlyArray<Draw.Rect>): Bounds =>
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
  rects: ReadonlyArray<Draw.Rect>,
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

export type Caster = Readonly<{ mesh: Mesh3D; box: ViewBox }>

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

export const cutoutBoxOf = (cutout: Cutout): ViewBox => ({
  left: cutout.left,
  top: cutout.top,
  right: cutout.left + cutout.width,
  bottom: Math.max(cutout.top + cutout.height, cutout.footY),
})
