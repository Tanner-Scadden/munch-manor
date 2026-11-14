// What the 3D renderer draws each frame: the Model, the world's strata, and
// the game's own camera it locks to. The view builds one each render and
// hands it to the world's element (src/render/iso/element.ts).

import { Predicate, Schema } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import type { Vector } from '../../world/schema/entitySchema'
import type { Camera } from '../camera'
import type { Drawable } from '../depth'

// NOTE: the world's three strata kept apart: what lies on the floor, what
// stands up at its feet, and what floats over both. In the cellar's dark a
// zombie shows only close to the viewing player (src/render/cellarDark.ts).
export type WorldStrata = Readonly<{
  ground: ReadonlyArray<Canvas.Shape>
  standing: ReadonlyArray<Drawable>
  overhead: ReadonlyArray<Canvas.Shape>
}>

export type IsoFrame = Readonly<{
  model: Model
  strata: WorldStrata
  camera: Camera
  // NOTE: the screen shake, in whole pixels.
  shake: Vector
  // NOTE: sprite sources the run may show soon, loaded ahead.
  preload: ReadonlyArray<string>
}>

const isIsoFrame = (value: unknown): value is IsoFrame =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'model') &&
  Predicate.hasProperty(value, 'strata') &&
  Predicate.hasProperty(value, 'camera')

// NOTE: the element's one property. Foldkit sets it as it is, never decoding
// it, so a declared Schema only names its type.
export const IsoFrameSchema = Schema.declare(isIsoFrame)
