import { Array, Option, Result, String, pipe } from 'effect'

import {
  type Container3D,
  FlatMaterial,
  Geometry3D,
  Material3D,
  Mesh3D,
  srgbToLinear,
} from '@pixi/3d'

import { cropSetOf, placeAt } from '../../art/sprite'
import { TILE_SIZE } from '../../shared/constants'
import { gapBoxOf } from '../../world/dining/chandelier'
import type { Level } from '../../world/level/arena'
import { SECRET_EXIT } from '../../world/level/plan'
import { secretShelfOf } from '../../world/library/secretShelf'
import {
  type CarvedShowpiece,
  carvedChandelierOf,
} from '../room/chandelierCarve'
import { chandelierRopeOf } from '../room/chandelierRope'
import {
  CHANDELIER_SHAPES,
  CHANDELIER_SPRITES,
  type ChandelierState,
} from '../room/diningArt'
import { FLAME_COLOR, FLAME_TIP_COLOR } from '../room/roomPalette'
import { SHELF_CARVES, isShelfGlint } from '../room/shelfCarve'
import { type CarvedMeshData, carvedMeshOf, uprightMeshOf } from './carvedMesh'
import { type ViewBox, isNearView } from './cull'
import { type Leaf, flatten } from './flatten'
import { UNIT } from './space'

const GLOWING: ReadonlySet<string> = new Set([FLAME_COLOR, FLAME_TIP_COLOR])

const geometryOf = (data: CarvedMeshData): Geometry3D => {
  const colors = Float32Array.from(data.colors, (channel, index) =>
    index % 4 === 3 ? channel : srgbToLinear(channel),
  )
  return new Geometry3D({
    positions: data.positions,
    normals: data.normals,
    indices: data.indices,
    colors,
  })
}

type Built = Readonly<{
  meshes: ReadonlyArray<Mesh3D>
  geometries: ReadonlyArray<Geometry3D>
  box: ViewBox
}>

const meshesOf = (
  input: Readonly<{
    data: Readonly<{ lit: CarvedMeshData; glowing: CarvedMeshData }>
    parent: Container3D
    materials: Readonly<{ lit: Material3D; glowing: FlatMaterial }>
    castsShadow: boolean
  }>,
): Readonly<{
  meshes: ReadonlyArray<Mesh3D>
  geometries: ReadonlyArray<Geometry3D>
}> => {
  const { data, parent, materials, castsShadow } = input
  const geometries = Array.map([data.lit, data.glowing], geometryOf)
  const [litGeometry, glowingGeometry] = geometries
  const meshes = Array.filterMap(
    [
      {
        geometry: litGeometry,
        material: materials.lit,
        castShadow: castsShadow,
      },
      {
        geometry: glowingGeometry,
        material: materials.glowing,
        castShadow: false,
      },
    ],
    ({ geometry, material, castShadow }) =>
      geometry === undefined || geometry.vertexCount === 0
        ? Result.failVoid
        : Result.succeed(
            new Mesh3D({
              geometry,
              material,
              castShadow,
              receiveShadow: true,
            }),
          ),
  )
  Array.forEach(meshes, mesh => {
    mesh.visible = false
    parent.addChild(mesh)
  })
  return { meshes, geometries }
}

const buildPiece = (
  input: Readonly<{
    piece: CarvedShowpiece
    anchor: Readonly<{ x: number; y: number }>
    parent: Container3D
    materials: Readonly<{ lit: Material3D; glowing: FlatMaterial }>
    castsShadow: boolean
  }>,
): Built => {
  const { piece, anchor, parent, materials, castsShadow } = input
  const placement = {
    left: anchor.x + piece.left,
    footY: anchor.y + piece.foot,
    rise: piece.rise,
  }
  return {
    ...meshesOf({
      data: carvedMeshOf({
        model: piece.model,
        placement,
        isGlowing: color => GLOWING.has(color),
      }),
      parent,
      materials,
      castsShadow,
    }),
    box: {
      left: placement.left,
      top: placement.footY - piece.rise - piece.model.depth,
      right: placement.left + piece.model.width,
      bottom: placement.footY,
    },
  }
}

const isSeeThrough = (fill: string | undefined): boolean =>
  String.startsWith('rgba')(fill ?? '')

const floorMarksOf = (
  anchor: Readonly<{ x: number; y: number }>,
): ReadonlyArray<Leaf> =>
  flatten([
    placeAt(
      anchor.x,
      anchor.y,
      Array.filter(
        CHANDELIER_SHAPES.Fallen,
        shape => shape._tag === 'Rect' && isSeeThrough(shape.fill),
      ),
    ),
  ])

export type Chandelier = Readonly<{
  apply: (
    input: Readonly<{ isDown: boolean; sway: number; view: ViewBox }>,
  ) => number
  floorMarks: (isDown: boolean) => ReadonlyArray<Leaf>
  destroy: () => void
}>

export const isChandelierSprite = cropSetOf([
  CHANDELIER_SPRITES.Hung,
  CHANDELIER_SPRITES.Fallen,
])

const lit = (): Material3D =>
  new Material3D({
    vertexColors: true,
    roughness: 1,
    metallic: 0,
    specular: { factor: 0 },
  })

export const chandelierOf = (
  input: Readonly<{ level: Level; parent: Container3D }>,
): Option.Option<Chandelier> =>
  Option.map(gapBoxOf(input.level), gap => {
    const x = Math.round((gap.left + gap.right) / 2)
    const anchors: Readonly<
      Record<ChandelierState, Readonly<{ x: number; y: number }>>
    > = {
      Hung: { x, y: Math.round(gap.top) },
      Fallen: { x, y: Math.round((gap.top + gap.bottom) / 2) },
    }
    const materials = {
      lit: lit(),
      glowing: new FlatMaterial({ vertexColors: true }),
    }
    const hung = buildPiece({
      piece: carvedChandelierOf('Hung'),
      anchor: anchors.Hung,
      parent: input.parent,
      materials,
      castsShadow: true,
    })
    const fallen = buildPiece({
      piece: carvedChandelierOf('Fallen'),
      anchor: anchors.Fallen,
      parent: input.parent,
      materials,
      castsShadow: true,
    })
    const ropes = Option.match(chandelierRopeOf(input.level), {
      onNone: () => [],
      onSome: pieces =>
        Array.map(['Hung', 'Fallen'] as const, state => ({
          isDown: state === 'Fallen',
          built: buildPiece({
            piece: pieces[state],
            anchor: { x: 0, y: 0 },
            parent: input.parent,
            materials,
            castsShadow: false,
          }),
        })),
    })
    const marks = floorMarksOf(anchors.Fallen)
    return {
      apply: ({ isDown, sway, view }) => {
        const isHungShown = !isDown && isNearView(hung.box, view)
        const isFallenShown = isDown && isNearView(fallen.box, view)
        Array.forEach(hung.meshes, mesh => {
          mesh.visible = isHungShown
          mesh.position.x = sway * UNIT
        })
        Array.forEach(fallen.meshes, mesh => {
          mesh.visible = isFallenShown
        })
        const ropesShown = Array.reduce(ropes, 0, (key, rope, index) => {
          const isShown =
            rope.isDown === isDown && isNearView(rope.built.box, view)
          Array.forEach(rope.built.meshes, mesh => {
            mesh.visible = isShown
          })
          return isShown ? key | (1 << index) : key
        })
        return (
          (isHungShown ? 1 + 2 * (sway + 64) : 0) +
          (isFallenShown ? 512 : 0) +
          ropesShown * 1024
        )
      },
      floorMarks: isDown => (isDown ? marks : []),
      destroy: () => {
        Array.forEach(
          Array.flatMap(
            [hung, fallen, ...Array.map(ropes, ({ built }) => built)],
            built => built.geometries,
          ),
          geometry => {
            geometry.destroy()
          },
        )
      },
    }
  })

export type Shelf = Readonly<{
  apply: (view: ViewBox) => void
  destroy: () => void
}>

export const shelfOf = (
  input: Readonly<{ level: Level; parent: Container3D }>,
): Option.Option<Shelf> =>
  pipe(
    secretShelfOf(input.level),
    Option.filter(() => !Array.contains(input.level.openExits, SECRET_EXIT)),
    Option.map(({ tile, side }) => {
      const model = SHELF_CARVES[side]
      const isEast = side === 'West'
      const north = tile.row * TILE_SIZE
      const built = meshesOf({
        data: uprightMeshOf({
          model,
          placement: {
            face: (isEast ? tile.column + 1 : tile.column) * TILE_SIZE,
            end: isEast ? north + model.width : north,
            height: model.height,
            facing: isEast ? 'East' : 'West',
          },
          isGlowing: isShelfGlint,
        }),
        parent: input.parent,
        materials: {
          lit: lit(),
          glowing: new FlatMaterial({ vertexColors: true }),
        },
        castsShadow: true,
      })
      const box: ViewBox = {
        left: tile.column * TILE_SIZE - model.depth,
        top: north - model.height,
        right: (tile.column + 1) * TILE_SIZE + model.depth,
        bottom: north + model.width,
      }
      return {
        apply: view => {
          const isShown = isNearView(box, view)
          Array.forEach(built.meshes, mesh => {
            mesh.visible = isShown
          })
        },
        destroy: () => {
          Array.forEach(built.geometries, geometry => {
            geometry.destroy()
          })
        },
      }
    }),
  )
