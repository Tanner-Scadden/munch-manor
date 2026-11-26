// What the 3D renderer draws each frame: the Model, the world's strata, and
// the game's own camera it locks to. The view builds one each render and
// hands it to the world's element (src/render/iso/element.ts).

import { type Option, Predicate, Schema } from 'effect'

import type { Model } from '../../app/model'
import type { Vector } from '../../world/schema/entitySchema'
import type { Camera } from '../camera'
import type { Drawable } from '../depth'
import type * as Draw from '../draw'
import type { IsoLens } from './diorama'
import type { HoldKey } from './hold'

// NOTE: the world's three strata kept apart: what lies on the floor, what
// stands up at its feet, and what floats over both. In the cellar's dark a
// zombie shows only close to the viewing player (src/render/cellarDark.ts).
export type WorldStrata = Readonly<{
  ground: ReadonlyArray<Draw.Shape>
  standing: ReadonlyArray<Drawable>
  overhead: ReadonlyArray<Draw.Shape>
}>

export type IsoFrame = Readonly<{
  model: Model
  strata: WorldStrata
  camera: Camera
  // NOTE: the game's own camera, or the title's diorama (diorama.ts).
  lens: IsoLens
  // NOTE: the screen shake, in whole pixels.
  shake: Vector
  // NOTE: sprite sources the run may show soon, loaded ahead.
  preload: ReadonlyArray<string>
  // NOTE: while the World stands still, the inputs its picture is drawn
  // from: a frame whose key matches the last drawn one is not drawn again
  // (hold.ts).
  hold: Option.Option<HoldKey>
}>

const isIsoFrame = (value: unknown): value is IsoFrame =>
  Predicate.isObject(value) &&
  Predicate.hasProperty(value, 'model') &&
  Predicate.hasProperty(value, 'strata') &&
  Predicate.hasProperty(value, 'camera')

// NOTE: the element's one property. Effect UI's host sets it as it is, never decoding
// it, so a declared Schema only names its type.
export const IsoFrameSchema = Schema.declare(isIsoFrame)
