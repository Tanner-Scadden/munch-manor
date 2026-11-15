// The roof leaks' puddles in the 3D scene (leaks.ts): one picture of the
// level, its bodies painted once and its glints and rings again only when
// what they show changes, on quads over the puddles' tiles alone.

import type { Application } from 'pixi.js'

import { FlatMaterial, type Mesh3D } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import type { Vector } from '../../world/schema/entitySchema'
import type { World } from '../../world/schema/worldSchema'
import { flatten } from './flatten'
import { buildTileQuads } from './house'
import { leakTilesOf, puddleGlintsOf, puddleKeyOf, puddlesOf } from './leaks'
import { FloorPicture } from './painter'
import type { Textures } from './textures'

const BODY_COAT = 0
const GLINT_COAT = 1

// NOTE: mutable on purpose: it owns the picture's texture and remembers
// what it was last painted for.
export class LeakLayer {
  readonly mesh: Mesh3D
  private readonly picture: FloorPicture
  private readonly level: Level
  private lastKey: string | undefined

  constructor(
    input: Readonly<{ app: Application; textures: Textures; level: Level }>,
  ) {
    const { level } = input
    this.level = level
    this.picture = new FloorPicture({ ...input, coats: 2 })
    this.picture.paintCoat(BODY_COAT, flatten(puddlesOf(level)))
    this.mesh = buildTileQuads({
      level,
      material: new FlatMaterial({
        baseColorTexture: this.picture.texture,
        alphaMode: 'blend',
      }),
      tiles: leakTilesOf(level),
    })
  }

  paint(input: Readonly<{ world: World; viewer: Vector }>): void {
    const view = { ...input, level: this.level }
    const key = puddleKeyOf(view)
    if (key === this.lastKey) {
      return
    }
    this.lastKey = key
    this.picture.paintCoat(GLINT_COAT, flatten(puddleGlintsOf(view)))
    this.picture.render()
  }

  destroy(): void {
    this.picture.destroy()
  }
}
