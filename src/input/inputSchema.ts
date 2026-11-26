import { Option, Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { Vector } from '../world/schema/entitySchema'

export const SurfaceRectangle = Schema.Struct({
  left: Schema.Finite,
  top: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  pixelRatio: Schema.optionalKey(Schema.Finite),
})
export type SurfaceRectangle = typeof SurfaceRectangle.Type

export const Stick = UiSchema.TaggedEnum({
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

export const MouseButton = UiSchema.TaggedEnum({
  Released: {},
  Held: { pointerId: Schema.Finite },
})
export type MouseButton = typeof MouseButton.Type

export const HoldButton = UiSchema.TaggedEnum({
  Released: {},
  Held: { pointerId: Schema.Finite },
})
export type HoldButton = typeof HoldButton.Type

export const PointerDevice = Schema.Literals(['Mouse', 'Touch'])
export type PointerDevice = typeof PointerDevice.Type

export const InputDevice = Schema.Literals([
  'KeyboardMouse',
  'Touch',
  'Gamepad',
])
export type InputDevice = typeof InputDevice.Type

export const TouchControls = Schema.Literals(['Allowed', 'Blocked'])
export type TouchControls = typeof TouchControls.Type

export const Orientation = Schema.Literals(['Landscape', 'Portrait'])
export type Orientation = typeof Orientation.Type

export const SlotClick = Schema.Literals(['Acts', 'PassesThrough'])
export type SlotClick = typeof SlotClick.Type

const FirePress = Schema.Literals(['Seen', 'Waiting'])

export const Gamepad = Schema.Struct({
  index: Schema.Finite,
  axes: Schema.Array(Schema.Finite),
  buttons: Schema.Array(Schema.Finite),
})
export type Gamepad = typeof Gamepad.Type

export const PadScope = Schema.Literals(['TopDialog', 'Coop', 'Page'])
export type PadScope = typeof PadScope.Type

export const PadClick = Schema.Literals(['Clicked', 'NothingFocused'])
export type PadClick = typeof PadClick.Type

export const Input = Schema.Struct({
  pressedKeys: Schema.Array(Schema.String),
  maybeMouseInView: Schema.Option(Vector),
  mouseButton: MouseButton,
  moveStick: Stick,
  aimStick: Stick,
  holdButton: HoldButton,
  slotClick: SlotClick,
  firePress: FirePress,
  maybeGamepad: Schema.Option(Gamepad),
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
  firePress: 'Seen',
  maybeGamepad: Option.none(),
}
