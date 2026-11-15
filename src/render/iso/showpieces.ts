// The house's carved showpieces in 3D (src/art/carve.ts): built once per
// level as real volumes, never through the per-frame batch, and only shown,
// hidden, or swung each frame. The first is the dining room's chandelier,
// hung over the table's gap or lying in it, with the cracks its fall left on
// the floor.

import { Array, Option, Result, String } from 'effect'

import {
  type Container3D,
  FlatMaterial,
  Geometry3D,
  Material3D,
  Mesh3D,
  srgbToLinear,
} from '@pixi/3d'

import { cropSetOf, placeAt } from '../../art/sprite'
import { gapBoxOf } from '../../world/dining/chandelier'
import type { Level } from '../../world/level/arena'
import {
  type CarvedShowpiece,
  carvedChandelierOf,
} from '../room/chandelierCarve'
import {
  CHANDELIER_SHAPES,
  CHANDELIER_SPRITES,
  type ChandelierState,
} from '../room/diningArt'
import { FLAME_COLOR, FLAME_TIP_COLOR } from '../room/roomPalette'
import { type CarvedMeshData, carvedMeshOf } from './carvedMesh'
import { type ViewBox, isNearView } from './cull'
import { type Leaf, flatten } from './flatten'
import { UNIT } from './space'

const GLOWING: ReadonlySet<string> = new Set([FLAME_COLOR, FLAME_TIP_COLOR])

// NOTE: the colors in linear light, as the renderer works.
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

const buildPiece = (
  input: Readonly<{
    piece: CarvedShowpiece
    anchor: Readonly<{ x: number; y: number }>
    parent: Container3D
    materials: Readonly<{ lit: Material3D; glowing: FlatMaterial }>
  }>,
): Built => {
  const { piece, anchor, parent, materials } = input
  const placement = {
    left: anchor.x + piece.left,
    footY: anchor.y + piece.foot,
    rise: piece.rise,
  }
  const data = carvedMeshOf({
    model: piece.model,
    placement,
    isGlowing: color => GLOWING.has(color),
  })
  const geometries = Array.map([data.lit, data.glowing], geometryOf)
  const [litGeometry, glowingGeometry] = geometries
  const meshes = Array.filterMap(
    [
      { geometry: litGeometry, material: materials.lit, castShadow: true },
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
  return {
    meshes,
    geometries,
    box: {
      left: placement.left,
      top: placement.footY - piece.rise - piece.model.depth,
      right: placement.left + piece.model.width,
      bottom: placement.footY,
    },
  }
}

// NOTE: what the fall left on the floor under the fallen chandelier: the
// 2D art's cracks and dust, its see-through rects, painted with the floor's
// glows.
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
  // NOTE: shows the state it is in, swung `sway` game pixels on its chain,
  // and hidden while it lies far off screen.
  apply: (
    input: Readonly<{ isDown: boolean; sway: number; view: ViewBox }>,
  ) => void
  // NOTE: the floor's marks for the state it is in.
  floorMarks: (isDown: boolean) => ReadonlyArray<Leaf>
  destroy: () => void
}>

// NOTE: the 2D sprite the carved chandelier stands in for, in either state,
// so the scene leaves the sprite out. A sprite is known by its crop too:
// in a production build the chandelier shares its atlas sheet with others.
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
    })
    const fallen = buildPiece({
      piece: carvedChandelierOf('Fallen'),
      anchor: anchors.Fallen,
      parent: input.parent,
      materials,
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
      },
      floorMarks: isDown => (isDown ? marks : []),
      destroy: () => {
        Array.forEach([...hung.geometries, ...fallen.geometries], geometry => {
          geometry.destroy()
        })
      },
    }
  })
