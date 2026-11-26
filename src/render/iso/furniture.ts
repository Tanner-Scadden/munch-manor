// The house's furniture in 3D (src/render/room/tallCover.ts): every tall
// piece's carved blocks set in their own batch once per level, as a game
// engine builds its static geometry, never stood again frame by frame. Each
// frame only shows or hides a piece by the view, and fades one while someone
// stands behind it; a still frame writes nothing. Its shadows cast from a
// second batch the shadow pass alone draws, and the shadow watch is handed a
// key of which pieces cast, so a fill draws its map again only when a piece
// culls in or out or fades past casting (shadowWatch.ts).

import { Array, Option } from 'effect'
import type { Texture } from 'pixi.js'

import {
  BatchedMesh3D,
  type Container3D,
  type Geometry3D,
  Material3D,
  Matrix4,
  RenderPassBit,
} from '@pixi/3d'

import { eyePixelsOf, isGlowingShape } from '../../art/sprite'
import type { Level } from '../../world/level/arena'
import { TALL_MOST } from '../depth'
import type * as Draw from '../draw'
import { type TallCover, tallCoverOf } from '../room/tallCover'
import { type ViewBox, isNearView } from './cull'
import { type Leaf, flatten } from './flatten'
import {
  CASTING_ALPHA,
  type VoxelBatch,
  fadeStepOf,
  isOpaqueAt,
  newReach,
} from './voxels'

// NOTE: one carved part of a piece, as `standLeaf` would stand it.
type Carving = Readonly<{
  geometry: Geometry3D
  eyes: Geometry3D | undefined
  caster: Geometry3D | undefined
  sheet: Texture
  elements: ReadonlyArray<number>
  // NOTE: the part's own alpha in the piece's art, before any fade.
  alpha: number
  isUpright: boolean
  isGlowing: boolean
}>

// NOTE: a part's slots in the batches (`NO_SLOT` for none) and what its
// material is picked by.
type Part = Readonly<{
  sheet: Texture
  alpha: number
  isUpright: boolean
  isGlowing: boolean
  slot: number
  eyesSlot: number
  casterSlot: number
}>

// NOTE: mutable on purpose: what each piece last showed, so a frame that
// changes nothing writes nothing.
type Piece = {
  readonly cover: TallCover
  readonly box: ViewBox
  readonly parts: ReadonlyArray<Part>
  isShown: boolean
  opacity: number
  casts: number
}

const NO_SLOT = -1

// NOTE: a piece's image leaves; the art is baked, so every leaf is one.
const imageLeavesOf = (cover: TallCover): ReadonlyArray<Leaf> =>
  Array.filter(flatten(cover.shapes), ({ shape }) => shape._tag === 'Image')

// NOTE: a piece's parts carved as `standLeaf` would stand them, each in
// front of the parts before it, or none while a sprite still loads.
const partsOf = (
  voxels: VoxelBatch,
  cover: TallCover,
): Option.Option<ReadonlyArray<Carving>> => {
  const reach = newReach()
  const parts: Array<Carving> = []
  for (const [part, leaf] of imageLeavesOf(cover).entries()) {
    const isGlowing = isGlowingShape(leaf.shape)
    const placement = voxels.placementOf({
      leaf,
      footY: cover.footY,
      part,
      isFlash: false,
      isGlowing,
      most: TALL_MOST,
      reach,
      eyes: eyePixelsOf(leaf.shape),
    })
    if (Option.isNone(placement)) {
      return Option.none()
    }
    const { carved, sheet, elements, blocks, isUpright } = placement.value
    reach.blocks = blocks
    parts.push({
      geometry: carved.geometry,
      eyes: carved.eyes,
      // NOTE: a piece standing upright, or a light of itself, casts
      // nothing, as `standLeaf` has it.
      caster: isGlowing || isUpright ? undefined : carved.caster,
      sheet,
      elements,
      alpha: leaf.alpha,
      isUpright,
      isGlowing,
    })
  }
  return Option.some(parts)
}

// NOTE: mutable on purpose: it owns its batches' slots for the level's life.
export class Furniture {
  private readonly level: Level
  private readonly parent: Container3D
  private readonly voxels: VoxelBatch
  private readonly byShapes: ReadonlyMap<ReadonlyArray<Draw.Shape>, TallCover>
  private pieces: ReadonlyArray<Piece> | undefined = undefined
  private batch: BatchedMesh3D | undefined = undefined
  private casters: BatchedMesh3D | undefined = undefined
  // NOTE: the shadow pass draws depth alone, so every caster shares one
  // plain material.
  private readonly casterMaterial = new Material3D({})

  constructor(
    input: Readonly<{ level: Level; parent: Container3D; voxels: VoxelBatch }>,
  ) {
    this.level = input.level
    this.parent = input.parent
    this.voxels = input.voxels
    this.byShapes = new Map(
      Array.map(tallCoverOf(input.level), cover => [cover.shapes, cover]),
    )
  }

  // NOTE: the game hands a tall piece back as its shapes, or as one group of
  // them at its fade, while someone stands behind it: the piece and its
  // opacity.
  fadeOf(
    shapes: ReadonlyArray<Draw.Shape>,
  ): Option.Option<Readonly<{ cover: TallCover; opacity: number }>> {
    const whole = this.byShapes.get(shapes)
    if (whole !== undefined) {
      return Option.some({ cover: whole, opacity: 1 })
    }
    const [first] = shapes
    if (shapes.length !== 1 || first?._tag !== 'Group') {
      return Option.none()
    }
    return Option.map(
      Option.fromUndefinedOr(this.byShapes.get(first.shapes)),
      cover => ({ cover, opacity: first.opacity ?? 1 }),
    )
  }

  // NOTE: shows the pieces near the view, each at its fade (1 for none),
  // and hands back a key of which parts cast, which changes when the
  // shadows do. Before every sprite has loaded it shows nothing.
  apply(
    input: Readonly<{
      fades: ReadonlyMap<TallCover, number>
      view: ViewBox
    }>,
  ): number {
    const pieces = this.pieces ?? this.build()
    if (pieces === undefined) {
      return 0
    }
    let key = 0
    for (const piece of pieces) {
      const isShown = isNearView(piece.box, input.view)
      const opacity = isShown ? (input.fades.get(piece.cover) ?? 1) : 1
      if (isShown !== piece.isShown || opacity !== piece.opacity) {
        piece.isShown = isShown
        piece.opacity = opacity
        piece.casts = this.show(piece)
      }
      key = Math.imul(key, 31) + piece.casts
    }
    return key
  }

  // NOTE: the slots of a piece set to how it shows now; how many of its
  // parts cast.
  private show(piece: Piece): number {
    const { batch, casters } = this
    if (batch === undefined || casters === undefined) {
      return 0
    }
    let casts = 0
    for (const part of piece.parts) {
      const alpha = part.alpha * piece.opacity
      const isVisible = piece.isShown && fadeStepOf(alpha) >= 1
      if (isVisible) {
        batch.setMaterialAt(
          part.slot,
          this.voxels.materialOf({
            sheet: part.sheet,
            alpha,
            isUpright: part.isUpright,
            isGlowing: part.isGlowing,
          }),
        )
      }
      // NOTE: a hidden slot leaves the transparent pass, which sorts hidden
      // slots too.
      batch.setPassesAt(
        part.slot,
        isVisible && !isOpaqueAt(alpha)
          ? RenderPassBit.TRANSPARENT
          : RenderPassBit.OPAQUE,
      )
      batch.setVisibleAt(part.slot, isVisible)
      if (part.eyesSlot !== NO_SLOT) {
        batch.setVisibleAt(part.eyesSlot, isVisible)
      }
      if (part.casterSlot !== NO_SLOT) {
        const isCasting = isVisible && alpha >= CASTING_ALPHA
        casters.setVisibleAt(part.casterSlot, isCasting)
        casts += isCasting ? 1 : 0
      }
    }
    return casts
  }

  // NOTE: every piece carved into slots set once, or none while a sprite
  // still loads (asking for them starts their loads).
  private build(): ReadonlyArray<Piece> | undefined {
    const carved = Array.map(tallCoverOf(this.level), cover =>
      Option.map(partsOf(this.voxels, cover), parts => ({ cover, parts })),
    )
    if (!Array.every(carved, Option.isSome)) {
      return undefined
    }
    const all = Array.getSomes(carved)
    const slots = Array.reduce(
      all,
      0,
      (sum, { parts }) =>
        sum +
        Array.reduce(
          parts,
          0,
          (count, part) => count + (part.eyes === undefined ? 1 : 2),
        ),
    )
    const casterSlots = Array.reduce(
      all,
      0,
      (sum, { parts }) =>
        sum + Array.filter(parts, part => part.caster !== undefined).length,
    )
    const batch = new BatchedMesh3D({ size: Math.max(1, slots) })
    const casters = new BatchedMesh3D({ size: Math.max(1, casterSlots) })
    this.parent.addChild(batch)
    this.parent.addChild(casters)
    let slot = 0
    let casterSlot = 0
    const pieces = Array.map(all, ({ cover, parts }): Piece => {
      const placed = Array.map(parts, (part): Part => {
        const matrix = new Matrix4().fromArray(part.elements)
        const at = slot
        batch.setGeometryAt(at, part.geometry)
        batch.setMatrixAt(at, matrix)
        batch.setVisibleAt(at, false)
        slot += 1
        let eyesSlot = NO_SLOT
        if (part.eyes !== undefined) {
          eyesSlot = slot
          batch.setGeometryAt(eyesSlot, part.eyes)
          batch.setMaterialAt(eyesSlot, this.voxels.glowMaterialOf(part.sheet))
          batch.setPassesAt(eyesSlot, RenderPassBit.OPAQUE)
          batch.setMatrixAt(eyesSlot, matrix)
          batch.setVisibleAt(eyesSlot, false)
          slot += 1
        }
        let castsAt = NO_SLOT
        if (part.caster !== undefined) {
          castsAt = casterSlot
          casters.setGeometryAt(castsAt, part.caster)
          casters.setMaterialAt(castsAt, this.casterMaterial)
          casters.setPassesAt(castsAt, RenderPassBit.SHADOW)
          casters.setMatrixAt(castsAt, matrix)
          casters.setVisibleAt(castsAt, false)
          casterSlot += 1
        }
        return {
          sheet: part.sheet,
          alpha: part.alpha,
          isUpright: part.isUpright,
          isGlowing: part.isGlowing,
          slot: at,
          eyesSlot,
          casterSlot: castsAt,
        }
      })
      return {
        cover,
        box: {
          left: cover.left,
          top: cover.artTop,
          right: cover.right,
          bottom: cover.footY,
        },
        parts: placed,
        isShown: false,
        opacity: 1,
        casts: 0,
      }
    })
    this.batch = batch
    this.casters = casters
    this.pieces = pieces
    return pieces
  }

  // NOTE: the batches go with the level's holder; the carves are the voxel
  // batch's, kept for the next level.
  destroy(): void {
    this.casterMaterial.destroy()
  }
}
