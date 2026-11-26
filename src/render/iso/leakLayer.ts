import type { Application } from 'pixi.js'

import { FlatMaterial, Material3D, type Mesh3D } from '@pixi/3d'

import type { Level } from '#world/level/arena.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import type { World } from '#world/schema/worldSchema.ts'

import { flatten } from './flatten.ts'
import { buildTileQuads } from './house.ts'
import { leakTilesOf, puddleGlintsOf, puddleKeyOf, puddlesOf } from './leaks.ts'
import { FloorPicture } from './painter.ts'
import type { Textures } from './textures.ts'

const BODY_LIFT = 0.013
const GLINT_LIFT = 0.0135

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
