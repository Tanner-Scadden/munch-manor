// The input's Schemas: the game surface's rectangle, the sticks, the mouse
// and hold buttons, the device, and the Model's `input` record.

import { Option, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Vector } from '../world/schema/entitySchema'

export const SurfaceRectangle = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  // NOTE: the page's devicePixelRatio when measured, so the stage can snap
  // one screen pixel to a whole number of device pixels (src/render/screen.ts).
  // Left out, the stage fits the surface as it always did.
  pixelRatio: Schema.optionalKey(Schema.Finite),
})
export type SurfaceRectangle = typeof SurfaceRectangle.Type

export const Stick = defineTaggedUnion({
  Idle: {},
  Active: {
    pointerId: Schema.Finite,
    originX: Schema.Finite,
    originY: Schema.Finite,
    currentX: Schema.Finite,
    currentY: Schema.Finite,
  },
})
export type Stick = typeof Stick.Type

export const MouseButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Finite },
})
export type MouseButton = typeof MouseButton.Type

// NOTE: a finger holding the touch HUD's hold-to-buy button, by its pointer,
// so lifting that finger lets go and no other finger does.
export const HoldButton = defineTaggedUnion({
  Released: {},
  Held: { pointerId: Schema.Finite },
})
export type HoldButton = typeof HoldButton.Type

export const PointerDevice = Schema.Literals(['Mouse', 'Touch'])
export type PointerDevice = typeof PointerDevice.Type

export const InputDevice = Schema.Literals(['KeyboardMouse', 'Touch'])
export type InputDevice = typeof InputDevice.Type

export const TouchControls = Schema.Literals(['Allowed', 'Blocked'])
export type TouchControls = typeof TouchControls.Type

export const Orientation = Schema.Literals(['Landscape', 'Portrait'])
export type Orientation = typeof Orientation.Type

// NOTE: what the click after a press on a HUD gun or knife slot does. A
// mouse press there mid-wave is a shot at the world beneath, so its click
// passes through; a touch, or a mouse outside a wave, acts on the slot.
export const SlotClick = Schema.Literals(['Acts', 'PassesThrough'])
export type SlotClick = typeof SlotClick.Type

export const Input = Schema.Struct({
  pressedKeys: Schema.Array(Schema.String),
  maybeMouseInView: Schema.Option(Vector),
  mouseButton: MouseButton,
  moveStick: Stick,
  aimStick: Stick,
  holdButton: HoldButton,
  slotClick: SlotClick,
})
export type Input = typeof Input.Type

export const idleInput: Input = {
  pressedKeys: [],
  maybeMouseInView: Option.none(),
  mouseButton: MouseButton.Released(),
  moveStick: Stick.Idle(),
  aimStick: Stick.Idle(),
  holdButton: HoldButton.Released(),
  slotClick: 'Acts',
}
