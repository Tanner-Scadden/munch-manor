import { type Option, Predicate, Schema } from 'effect'

import type { Model } from '../../app/model'
import type { Vector } from '../../world/schema/entitySchema'
import type { Camera } from '../camera'
import type { Drawable } from '../depth'
import type * as Draw from '../draw'
import type { IsoLens } from './diorama'
import type { HoldKey } from './hold'

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
