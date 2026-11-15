// The roof leaks' puddles in the 3D scene (leaks.ts): two pictures of the
// level on quads over the puddles' tiles alone. The water's body is lit by
// the room as the floor is, cut into its bands, so it shows blue-grey in the
// light and is lost in the cellar's dark; it is painted once. The glints
// and rings over it are light of their own, unlit, painted again only when
// what they show changes.

import type { Application } from 'pixi.js'

import { FlatMaterial, Material3D, type Mesh3D } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import { flatten } from './flatten'
import { buildTileQuads } from './house'
import { leakTilesOf, puddleGlintsOf, puddleKeyOf, puddlesOf } from './leaks'
import { FloorPicture } from './painter'
import type { Textures } from './textures'

// NOTE: the puddles' bodies sit over the ground's glows (0.012), their
// glints over them, and both under the storm's thrown light (0.014).
const BODY_LIFT = 0.013
const GLINT_LIFT = 0.0135

// NOTE: mutable on purpose: it owns the pictures' textures and remembers
// what the glints were last painted for.
export class LeakLayer {
  readonly body: Mesh3D
  readonly glints: Mesh3D
  private readonly water: FloorPicture
  private readonly light: FloorPicture
  private readonly level: Level
  private lastKey: string | undefined

  constructor(
    input: Readonly<{ app: Application; textures: Textures; level: Level }>,
  ) {
    const { level, textures } = input
    this.level = level
    this.water = new FloorPicture(input)
    this.water.paintLeaves(flatten(puddlesOf(level)))
    this.light = new FloorPicture(input)
    this.body = buildTileQuads({
      level,
      material: new Material3D({
        baseColorTexture: this.water.texture,
        roughness: 1,
        metallic: 0,
        specular: { factor: 0 },
        alphaMode: 'blend',
        ...textures.lookOptions('House'),
      }),
      tiles: leakTilesOf({ level, lift: BODY_LIFT }),
    })
    this.glints = buildTileQuads({
      level,
      material: new FlatMaterial({
        baseColorTexture: this.light.texture,
        alphaMode: 'blend',
      }),
      tiles: leakTilesOf({ level, lift: GLINT_LIFT }),
    })
  }

  paint(
    input: Readonly<{
      world: World
      viewer: Readonly<{ x: number; y: number; facing: Vector }>
    }>,
  ): void {
    const view = { ...input, level: this.level }
    const key = puddleKeyOf(view)
    if (key === this.lastKey) {
      return
    }
    this.lastKey = key
    this.light.paintLeaves(flatten(puddleGlintsOf(view)))
  }

  destroy(): void {
    this.water.destroy()
    this.light.destroy()
  }
}
