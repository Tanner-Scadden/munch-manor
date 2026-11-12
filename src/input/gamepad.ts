import { Array, Equal, Function, Option, String, pipe } from 'effect'

import type { Vector } from '../world/schema/entitySchema'
import {
  ZERO_VECTOR,
  addVectors,
  clampLength,
  normalize,
  scaleVector,
  vectorLength,
} from '../world/step/geometry'
import type { Gamepad } from './inputSchema'

// A controller in the standard layout (the Gamepad API's `standard`
// mapping): its buttons as codes, its sticks as move and aim, and the
// polled record the Subscription sends (src/app/subscriptions.ts). Pads are
// never rebound (docs/INPUT_PLAN.md, "Decided"), so the layout is fixed.

// NOTE: the standard mapping's buttons, in its index order. A pad button
// becomes a press through the same key table the keyboard uses
// (src/input/keyActions.ts), named by these codes, which no keyboard sends.
const STANDARD_BUTTONS = [
  'GamepadA',
  'GamepadB',
  'GamepadX',
  'GamepadY',
  'GamepadLB',
  'GamepadRB',
  'GamepadLT',
  'GamepadRT',
  'GamepadSelect',
  'GamepadStart',
  'GamepadLeftStick',
  'GamepadRightStick',
  'GamepadUp',
  'GamepadDown',
  'GamepadLeft',
  'GamepadRight',
  'GamepadHome',
] as const

type PadCode = (typeof STANDARD_BUTTONS)[number]

export const PAD_A: PadCode = 'GamepadA'
export const PAD_B: PadCode = 'GamepadB'
export const PAD_X: PadCode = 'GamepadX'
export const PAD_Y: PadCode = 'GamepadY'
export const PAD_LB: PadCode = 'GamepadLB'
export const PAD_LT: PadCode = 'GamepadLT'
const PAD_RT: PadCode = 'GamepadRT'
export const PAD_SELECT: PadCode = 'GamepadSelect'
export const PAD_START: PadCode = 'GamepadStart'

const PAD_PREFIX = 'Gamepad'

export const isPadCode = (code: string): boolean =>
  String.startsWith(PAD_PREFIX)(code)

// NOTE: the triggers are analog: a light squeeze already pulls, as on a
// console. The other buttons count as held past halfway.
const TRIGGER_THRESHOLD = 0.3
const BUTTON_THRESHOLD = 0.5

const thresholdOf = (code: PadCode): number =>
  code === 'GamepadLT' || code === PAD_RT ? TRIGGER_THRESHOLD : BUTTON_THRESHOLD

// NOTE: a resting stick drifts a little, worse with age, so a deflection
// under this is no deflection at all, and the rest is rescaled from zero.
const PAD_DEAD_ZONE = 0.25

// NOTE: the axes and buttons go up in 1/64 steps, so stick noise below a
// step sends nothing and a resting pad is quiet.
const QUANTUM = 64

const quantize = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * QUANTUM) / QUANTUM : 0

const STICK_AXES = 4

// NOTE: one pad as the browser reports it, the part this module reads.
export type PadReading = Readonly<{
  index: number
  connected: boolean
  axes: ReadonlyArray<number>
  buttons: ReadonlyArray<Readonly<{ value: number; pressed: boolean }>>
}>

// NOTE: a digital button reports `pressed` with a value of 0 on a few
// browsers, so pressed counts as fully down.
const buttonValueOf = ({
  value,
  pressed,
}: Readonly<{ value: number; pressed: boolean }>): number =>
  pressed ? Math.max(1, value) : value

const polledOf = (pad: PadReading): Gamepad => ({
  index: pad.index,
  axes: Array.map(Array.take(pad.axes, STICK_AXES), quantize),
  buttons: Array.map(Array.take(pad.buttons, STANDARD_BUTTONS.length), button =>
    quantize(buttonValueOf(button)),
  ),
})

// NOTE: the pad to read: the one read last while it is still there, or
// else the first connected one. Slots can be null, so a pad is found by
// its index, never assumed in slot 0.
export const pickPad: {
  (
    maybeLastIndex: Option.Option<number>,
  ): (pads: ReadonlyArray<PadReading | null>) => Option.Option<Gamepad>
  (
    pads: ReadonlyArray<PadReading | null>,
    maybeLastIndex: Option.Option<number>,
  ): Option.Option<Gamepad>
} = Function.dual(
  2,
  (
    pads: ReadonlyArray<PadReading | null>,
    maybeLastIndex: Option.Option<number>,
  ): Option.Option<Gamepad> => {
    const connected = Array.filter(
      pads,
      (pad): pad is PadReading => pad?.connected === true,
    )
    return pipe(
      Option.flatMap(maybeLastIndex, lastIndex =>
        Array.findFirst(connected, pad => pad.index === lastIndex),
      ),
      Option.orElse(() => Array.head(connected)),
      Option.map(polledOf),
    )
  },
)

const numberArrayEquivalence = Array.makeEquivalence<number>(Equal.equals)

export const isSamePoll: {
  (that: Gamepad): (self: Gamepad) => boolean
  (self: Gamepad, that: Gamepad): boolean
} = Function.dual(
  2,
  (self: Gamepad, that: Gamepad): boolean =>
    self.index === that.index &&
    numberArrayEquivalence(self.axes, that.axes) &&
    numberArrayEquivalence(self.buttons, that.buttons),
)

// HELD

const buttonValue = (pad: Gamepad, position: number): number =>
  Option.getOrElse(Array.get(pad.buttons, position), () => 0)

const heldCodes = (pad: Gamepad): ReadonlyArray<string> =>
  Array.filter(
    STANDARD_BUTTONS,
    (code, position) => buttonValue(pad, position) >= thresholdOf(code),
  )

const isHeld = (maybePad: Option.Option<Gamepad>, code: PadCode): boolean =>
  Option.exists(maybePad, pad => Array.contains(heldCodes(pad), code))

// NOTE: the buttons down now that were not down at the last poll. A pad
// at a new index is a new pad, every button of it fresh.
export const newlyPressed: {
  (
    after: Gamepad,
  ): (maybeBefore: Option.Option<Gamepad>) => ReadonlyArray<string>
  (maybeBefore: Option.Option<Gamepad>, after: Gamepad): ReadonlyArray<string>
} = Function.dual(
  2,
  (
    maybeBefore: Option.Option<Gamepad>,
    after: Gamepad,
  ): ReadonlyArray<string> => {
    const before = pipe(
      maybeBefore,
      Option.filter(pad => pad.index === after.index),
      Option.match({ onNone: () => [], onSome: heldCodes }),
    )
    return Array.filter(heldCodes(after), code => !Array.contains(before, code))
  },
)

// STICKS

const axisValue = (pad: Gamepad, position: number): number =>
  Option.getOrElse(Array.get(pad.axes, position), () => 0)

const stickOf = (pad: Gamepad, xAxis: number, yAxis: number): Vector => {
  const raw = clampLength(
    { x: axisValue(pad, xAxis), y: axisValue(pad, yAxis) },
    1,
  )
  const length = vectorLength(raw)
  return length < PAD_DEAD_ZONE
    ? ZERO_VECTOR
    : scaleVector(raw, (length - PAD_DEAD_ZONE) / (1 - PAD_DEAD_ZONE) / length)
}

const leftStick = (pad: Gamepad): Vector => stickOf(pad, 0, 1)

const rightStick = (pad: Gamepad): Vector => stickOf(pad, 2, 3)

// NOTE: two opposite held directions as one axis, -1, 0, or 1, for the
// d-pad here and the keyboard's arrows and WASD (src/input/input.ts).
export const axis: {
  (isPositive: boolean): (isNegative: boolean) => number
  (isNegative: boolean, isPositive: boolean): number
} = Function.dual(
  2,
  (isNegative: boolean, isPositive: boolean): number =>
    (isPositive ? 1 : 0) - (isNegative ? 1 : 0),
)

const dpadMove = (pad: Gamepad): Vector => {
  const held = heldCodes(pad)
  return pipe(
    {
      x: axis(
        Array.contains(held, 'GamepadLeft'),
        Array.contains(held, 'GamepadRight'),
      ),
      y: axis(
        Array.contains(held, 'GamepadUp'),
        Array.contains(held, 'GamepadDown'),
      ),
    },
    normalize,
    Option.getOrElse(() => ZERO_VECTOR),
  )
}

// NOTE: the left stick and the d-pad both walk.
export const padMove = (maybePad: Option.Option<Gamepad>): Vector =>
  Option.match(maybePad, {
    onNone: () => ZERO_VECTOR,
    onSome: pad => clampLength(addVectors(leftStick(pad), dpadMove(pad)), 1),
  })

// NOTE: the right stick aims while it is pushed; let go, it aims nowhere,
// and the player faces the way they walk.
export const padAim = (
  maybePad: Option.Option<Gamepad>,
): Option.Option<Vector> =>
  Option.flatMap(maybePad, pad => normalize(rightStick(pad)))

export const isPadFiring = (maybePad: Option.Option<Gamepad>): boolean =>
  isHeld(maybePad, PAD_RT)

// NOTE: A is the interact button: held to buy, READY, MEDIC!, as Enter.
export const isPadInteracting = (maybePad: Option.Option<Gamepad>): boolean =>
  isHeld(maybePad, PAD_A)

// NOTE: a pad that has a button down or a stick past its dead zone is in
// use, and takes the device from the mouse. A resting pad takes nothing.
export const isPadStirred = (pad: Gamepad): boolean =>
  Array.isReadonlyArrayNonEmpty(heldCodes(pad)) ||
  vectorLength(leftStick(pad)) > 0 ||
  vectorLength(rightStick(pad)) > 0
