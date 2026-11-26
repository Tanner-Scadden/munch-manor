import { type Option, Predicate, Schema } from 'effect'

import type { Model } from '#app/model.ts'
import type { Camera } from '#render/camera.ts'
import type { Drawable } from '#render/depth.ts'
import type * as Draw from '#render/draw.ts'
import type { Vector } from '#world/schema/entitySchema.ts'

import type { IsoLens } from './diorama.ts'
import type { HoldKey } from './hold.ts'

export type WorldStrata = Readonly<{
  ground: ReadonlyArray<Draw.Shape>
  standing: ReadonlyArray<Drawable>
  overhead: ReadonlyArray<Draw.Shape>
}>

export type IsoFrame = Readonly<{
  model: Model
  strata: WorldStrata
  camera: Camera
  lens: IsoLens
  shake: Vector
  preload: ReadonlyArray<string>
  hold: Option.Option<HoldKey>
}>

const isIsoFrame = (value: unknown): value is IsoFrame =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'model') &&
  Predicate.hasProperty(value, 'strata') &&
  Predicate.hasProperty(value, 'camera')

export const IsoFrameSchema = Schema.declare(isIsoFrame)
