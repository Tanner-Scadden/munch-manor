import { Array, Equal, Function, Option, Schema, String, pipe } from 'effect'

import type { Vector } from '#world/schema/entitySchema.ts'
import {
  ZERO_VECTOR,
  addVectors,
  clampLength,
  normalize,
  scaleVector,
  vectorLength,
} from '#world/step/geometry.ts'

import type { Gamepad } from './inputSchema.ts'

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
export const PAD_RB: PadCode = 'GamepadRB'
export const PAD_LT: PadCode = 'GamepadLT'
const PAD_RT: PadCode = 'GamepadRT'
export const PAD_SELECT: PadCode = 'GamepadSelect'
export const PAD_START: PadCode = 'GamepadStart'

const PAD_PREFIX = 'Gamepad'

export const isPadCode = (code: string): boolean =>
  String.startsWith(PAD_PREFIX)(code)

const TRIGGER_THRESHOLD = 0.3
const BUTTON_THRESHOLD = 0.5

const thresholdOf = (code: PadCode): number =>
  code === 'GamepadLT' || code === PAD_RT ? TRIGGER_THRESHOLD : BUTTON_THRESHOLD

const PAD_DEAD_ZONE = 0.25

const QUANTUM = 64

const quantize = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * QUANTUM) / QUANTUM : 0

const STICK_AXES = 4

export type PadReading = Readonly<{
  index: number
  connected: boolean
  axes: ReadonlyArray<number>
  buttons: ReadonlyArray<Readonly<{ value: number; pressed: boolean }>>
}>

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

const buttonValue = (pad: Gamepad, position: number): number =>
  Option.getOrElse(Array.get(pad.buttons, position), () => 0)

const heldCodes = (pad: Gamepad): ReadonlyArray<string> =>
  Array.filter(
    STANDARD_BUTTONS,
    (code, position) => buttonValue(pad, position) >= thresholdOf(code),
  )

const isHeld = (maybePad: Option.Option<Gamepad>, code: PadCode): boolean =>
  Option.exists(maybePad, pad => Array.contains(heldCodes(pad), code))

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

export const padMove = (maybePad: Option.Option<Gamepad>): Vector =>
  Option.match(maybePad, {
    onNone: () => ZERO_VECTOR,
    onSome: pad => clampLength(addVectors(leftStick(pad), dpadMove(pad)), 1),
  })

export const padAim = (
  maybePad: Option.Option<Gamepad>,
): Option.Option<Vector> =>
  Option.flatMap(maybePad, pad => normalize(rightStick(pad)))

export const padAimReach = (
  maybePad: Option.Option<Gamepad>,
): Option.Option<Vector> =>
  Option.flatMap(maybePad, pad =>
    Option.liftPredicate(rightStick(pad), stick => vectorLength(stick) > 0),
  )

export const isPadFiring = (maybePad: Option.Option<Gamepad>): boolean =>
  isHeld(maybePad, PAD_RT)

export const isPadInteracting = (maybePad: Option.Option<Gamepad>): boolean =>
  isHeld(maybePad, PAD_A)

export const isPadStirred = (pad: Gamepad): boolean =>
  Array.isReadonlyArrayNonEmpty(heldCodes(pad)) ||
  vectorLength(leftStick(pad)) > 0 ||
  vectorLength(rightStick(pad)) > 0

export const PadDirection = Schema.Literals(['Up', 'Down', 'Left', 'Right'])
export type PadDirection = typeof PadDirection.Type

const MENU_FLICK = 0.5

export const MENU_REPEAT_DELAY_MS = 400
export const MENU_REPEAT_MS = 110

const DPAD_DIRECTIONS: ReadonlyArray<readonly [PadCode, PadDirection]> = [
  ['GamepadUp', 'Up'],
  ['GamepadDown', 'Down'],
  ['GamepadLeft', 'Left'],
  ['GamepadRight', 'Right'],
]

const stickDirection = (stick: Vector): Option.Option<PadDirection> => {
  if (vectorLength(stick) < MENU_FLICK) {
    return Option.none()
  } else if (Math.abs(stick.x) > Math.abs(stick.y)) {
    return Option.some(stick.x > 0 ? 'Right' : 'Left')
  } else {
    return Option.some(stick.y > 0 ? 'Down' : 'Up')
  }
}

export const padDirection = (pad: Gamepad): Option.Option<PadDirection> => {
  const held = heldCodes(pad)
  return pipe(
    Array.findFirst(DPAD_DIRECTIONS, ([code]) => Array.contains(held, code)),
    Option.map(([, direction]) => direction),
    Option.orElse(() => stickDirection(leftStick(pad))),
  )
}

export const newDirection: {
  (
    after: Gamepad,
  ): (maybeBefore: Option.Option<Gamepad>) => Option.Option<PadDirection>
  (
    maybeBefore: Option.Option<Gamepad>,
    after: Gamepad,
  ): Option.Option<PadDirection>
} = Function.dual(
  2,
  (
    maybeBefore: Option.Option<Gamepad>,
    after: Gamepad,
  ): Option.Option<PadDirection> => {
    const maybeWas = pipe(
      maybeBefore,
      Option.filter(pad => pad.index === after.index),
      Option.flatMap(padDirection),
    )
    return Option.filter(
      padDirection(after),
      direction => !Option.contains(maybeWas, direction),
    )
  },
)
