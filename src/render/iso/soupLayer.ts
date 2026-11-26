import { Option } from 'effect'
import type { Application } from 'pixi.js'

import { FlatMaterial, type Mesh3D } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import type { World } from '../../world/schema/worldSchema'
import type { Mote } from './air'
import { flatten } from './flatten'
import { buildTileQuads } from './house'
import { STRIKE_STEPS, litOf, strikeStepOf } from './leaks'
import { FloorPicture } from './painter'
import {
  type Bubble,
  type SoupMirror,
  type Splat,
  bubbleMotesOf,
  bubblesOfSplat,
  soupFootprintOf,
  soupGlintsOf,
  soupMirrorsOf,
  spilledFootprintOf,
  splatOf,
  splatTilesOf,
  stewShapesOf,
} from './soup'
import type { Textures } from './textures'

const STEW_COAT = 0
const GLINT_COAT = 1
const KEYED_MIRRORS = 16

type Pot = Readonly<{
  splat: Splat
  mirrors: ReadonlyArray<SoupMirror>
  bubbles: ReadonlyArray<Bubble>
}>

const potOf = (level: Level, splat: Splat): Pot => ({
  splat,
  mirrors: soupMirrorsOf({ level, splat }),
  bubbles: bubblesOfSplat(splat),
})

export class SoupLayer {
  readonly mesh: Mesh3D
  private readonly picture: FloorPicture
  private readonly soup: Pot
  private readonly spilled: Pot
  private shown: Pot
  private lastKey: number | undefined

  constructor(
    input: Readonly<{ app: Application; textures: Textures; level: Level }>,
  ) {
    const { level } = input
    const footprint = soupFootprintOf(level)
    this.soup = potOf(level, splatOf(footprint))
    this.spilled = potOf(
      level,
      splatOf(
        Option.getOrElse(
          spilledFootprintOf({ level, soup: footprint }),
          () => footprint,
        ),
      ),
    )
    this.shown = this.soup
    this.picture = new FloorPicture({ ...input, coats: 2 })
    this.mesh = buildTileQuads({
      level,
      material: new FlatMaterial({
        baseColorTexture: this.picture.texture,
        alphaMode: 'blend',
      }),
      tiles: splatTilesOf({
        level,
        splats: [this.soup.splat, this.spilled.splat],
      }),
    })
  }

  paint(input: Readonly<{ world: World; isSpilled: boolean }>): void {
    const { world, isSpilled } = input
    const pot = isSpilled ? this.spilled : this.soup
    const lit = litOf(world)
    const strikeStep = strikeStepOf(world)
    let litBits = 0
    const keyed = Math.min(pot.mirrors.length, KEYED_MIRRORS)
    for (let index = 0; index < keyed; index += 1) {
      const near = pot.mirrors[index]
      if (near !== undefined && lit.has(near.mirror.kind)) {
        litBits += 2 ** index
      }
    }
    const key =
      (litBits * (STRIKE_STEPS + 1) + strikeStep) * 2 + (isSpilled ? 1 : 0)
    if (key === this.lastKey) {
      return
    }
    if (pot !== this.shown || this.lastKey === undefined) {
      this.picture.paintCoat(STEW_COAT, flatten(stewShapesOf(pot.splat)))
    }
    this.shown = pot
    this.lastKey = key
    this.picture.paintCoat(
      GLINT_COAT,
      flatten(
        soupGlintsOf({
          splat: pot.splat,
          mirrors: pot.mirrors,
          lit,
          strikeStep,
        }),
      ),
    )
    this.picture.render()
  }

  bubblesOf(world: World): ReadonlyArray<Mote> {
    return bubbleMotesOf({ bubbles: this.shown.bubbles, world })
  }

  destroy(): void {
    this.picture.destroy()
  }
}
