import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type Camera, viewToWorld } from './camera'
import { STICK_DEAD_ZONE, STICK_FIRE_ZONE, STICK_RADIUS_PX } from './constants'
import {
  ZERO_VECTOR,
  addVectors,
  clampLength,
  directionBetween,
  normalize,
  scaleVector,
  vectorLength,
} from './geometry'
import { INTERACT_KEY } from './keyActions'
import {
  HoldButton,
  type Input,
  type Intent,
  MouseButton,
  type Player,
  type PointerDevice,
  Stick,
  type SurfaceRectangle,
  type Trigger,
  type Vector,
} from './model'
import { clientToView, isLeftHalf } from './screen'
import type { FocusStep } from './stepWorld'

// KEYS

const UP_KEY = 'KeyW'
const DOWN_KEY = 'KeyS'
const LEFT_KEY = 'KeyA'
const RIGHT_KEY = 'KeyD'
const START_KEY = 'Enter'
const ENDLESS_KEY = 'KeyE'
const KEEP_GOING_KEY = 'KeyK'
const CHARACTER_KEY = 'KeyC'
const PAUSE_KEY = 'Escape'
const MENU_KEY = 'KeyH'
const LOBBY_KEY = 'KeyL'
const PREVIOUS_BUTTON_KEYS: ReadonlyArray<string> = ['ArrowLeft', 'ArrowUp']
const NEXT_BUTTON_KEYS: ReadonlyArray<string> = ['ArrowRight', 'ArrowDown']

export const maybeFocusStep = (code: string): Option.Option<FocusStep> => {
  if (Array.contains(PREVIOUS_BUTTON_KEYS, code)) {
    return Option.some('Previous')
  } else if (Array.contains(NEXT_BUTTON_KEYS, code)) {
    return Option.some('Next')
  } else {
    return Option.none()
  }
}

// NOTE: how far an arrow key moves focus along a menu's buttons.
export const FOCUS_STEP_OFFSET: Readonly<Record<FocusStep, number>> = {
  Previous: -1,
  Next: 1,
}

export const isMenuKey = (code: string): boolean => code === MENU_KEY

export const isLobbyKey = (code: string): boolean => code === LOBBY_KEY

export const isStartKey = (code: string): boolean => code === START_KEY

export const isEndlessKey = (code: string): boolean => code === ENDLESS_KEY

export const isKeepGoingKey = (code: string): boolean => code === KEEP_GOING_KEY

export const isCharacterKey = (code: string): boolean => code === CHARACTER_KEY

export const isPauseKey = (code: string): boolean => code === PAUSE_KEY

const axis = (isNegative: boolean, isPositive: boolean): number =>
  (isPositive ? 1 : 0) - (isNegative ? 1 : 0)

const keyboardMove = (pressedKeys: ReadonlyArray<string>): Vector =>
  pipe(
    {
      x: axis(
        Array.contains(pressedKeys, LEFT_KEY),
        Array.contains(pressedKeys, RIGHT_KEY),
      ),
      y: axis(
        Array.contains(pressedKeys, UP_KEY),
        Array.contains(pressedKeys, DOWN_KEY),
      ),
    },
    normalize,
    Option.getOrElse(() => ZERO_VECTOR),
  )

export const pressKey = (input: Input, code: string): Input =>
  modifyFields(input, {
    pressedKeys: pressedKeys =>
      Array.contains(pressedKeys, code)
        ? pressedKeys
        : Array.append(pressedKeys, code),
  })

export const releaseKey = (input: Input, code: string): Input =>
  modifyFields(input, {
    pressedKeys: Array.filter(pressedCode => pressedCode !== code),
  })

// NOTE: macOS sends no keyup for a key released while Command is down, so
// Command lets go of every key rather than leave one held for good.
export const releaseKeys = (input: Input): Input =>
  modifyFields(input, { pressedKeys: () => [] })

export const releaseAll = (input: Input): Input =>
  modifyFields(input, {
    pressedKeys: () => [],
    mouseButton: () => MouseButton.Released(),
    moveStick: () => Stick.Idle(),
    aimStick: () => Stick.Idle(),
    holdButton: () => HoldButton.Released(),
  })

export const releaseSticks = (input: Input): Input =>
  modifyFields(input, {
    moveStick: () => Stick.Idle(),
    aimStick: () => Stick.Idle(),
  })

// POINTERS

export type PointerPress = Readonly<{
  pointerId: number
  device: PointerDevice
  clientX: number
  clientY: number
}>

type PointerPosition = Readonly<{
  pointerId: number
  clientX: number
  clientY: number
}>

const activateIfIdle = (stick: Stick, press: PointerPress): Stick =>
  Stick.match(stick, {
    Idle: () =>
      Stick.Active({
        pointerId: press.pointerId,
        originX: press.clientX,
        originY: press.clientY,
        currentX: press.clientX,
        currentY: press.clientY,
      }),
    Active: () => stick,
  })

const pressTouch = (
  input: Input,
  surface: SurfaceRectangle,
  press: PointerPress,
): Input => {
  if (isLeftHalf(surface, press.clientX)) {
    return modifyFields(input, {
      moveStick: stick => activateIfIdle(stick, press),
    })
  } else {
    return modifyFields(input, {
      aimStick: stick => activateIfIdle(stick, press),
    })
  }
}

const pressMouse = (
  input: Input,
  surface: SurfaceRectangle,
  press: PointerPress,
): Input =>
  modifyFields(input, {
    mouseButton: () => MouseButton.Held({ pointerId: press.pointerId }),
    maybeMouseInView: () =>
      clientToView(surface, { x: press.clientX, y: press.clientY }),
  })

export const pressPointer = (
  input: Input,
  maybeSurface: Option.Option<SurfaceRectangle>,
  press: PointerPress,
): Input =>
  Option.match(maybeSurface, {
    onNone: () => input,
    onSome: surface =>
      press.device === 'Mouse'
        ? pressMouse(input, surface, press)
        : pressTouch(input, surface, press),
  })

const moveStickPointer = (stick: Stick, position: PointerPosition): Stick =>
  Stick.match(stick, {
    Idle: () => stick,
    Active: active =>
      active.pointerId === position.pointerId
        ? Stick.Active({
            pointerId: active.pointerId,
            originX: active.originX,
            originY: active.originY,
            currentX: position.clientX,
            currentY: position.clientY,
          })
        : stick,
  })

const isMouseHeldBy = (input: Input, pointerId: number): boolean =>
  MouseButton.match(input.mouseButton, {
    Released: () => false,
    Held: held => held.pointerId === pointerId,
  })

export const movePointer = (
  input: Input,
  maybeSurface: Option.Option<SurfaceRectangle>,
  position: PointerPosition,
): Input =>
  isMouseHeldBy(input, position.pointerId)
    ? moveMouse(input, maybeSurface, {
        x: position.clientX,
        y: position.clientY,
      })
    : modifyFields(input, {
        moveStick: stick => moveStickPointer(stick, position),
        aimStick: stick => moveStickPointer(stick, position),
      })

const releaseStickPointer = (stick: Stick, pointerId: number): Stick =>
  Stick.match(stick, {
    Idle: () => stick,
    Active: active => (active.pointerId === pointerId ? Stick.Idle() : stick),
  })

const releaseMouseButton = (
  mouseButton: MouseButton,
  pointerId: number,
): MouseButton =>
  MouseButton.match(mouseButton, {
    Released: () => mouseButton,
    Held: held =>
      held.pointerId === pointerId ? MouseButton.Released() : mouseButton,
  })

const releaseHoldButton = (
  holdButton: HoldButton,
  pointerId: number,
): HoldButton =>
  HoldButton.match(holdButton, {
    Released: () => holdButton,
    Held: held =>
      held.pointerId === pointerId ? HoldButton.Released() : holdButton,
  })

export const releasePointer = (input: Input, pointerId: number): Input =>
  modifyFields(input, {
    moveStick: stick => releaseStickPointer(stick, pointerId),
    aimStick: stick => releaseStickPointer(stick, pointerId),
    mouseButton: mouseButton => releaseMouseButton(mouseButton, pointerId),
    holdButton: holdButton => releaseHoldButton(holdButton, pointerId),
  })

// NOTE: a finger on the touch HUD's hold button. The button sits outside
// the game surface, so the finger never starts a stick, and the sticks'
// own fingers keep their sticks.
export const pressHoldButton = (input: Input, pointerId: number): Input =>
  modifyFields(input, {
    holdButton: holdButton =>
      HoldButton.match(holdButton, {
        Released: () => HoldButton.Held({ pointerId }),
        Held: () => holdButton,
      }),
  })

export const moveMouse = (
  input: Input,
  maybeSurface: Option.Option<SurfaceRectangle>,
  client: Vector,
): Input =>
  Option.match(maybeSurface, {
    onNone: () => input,
    onSome: surface =>
      modifyFields(input, {
        maybeMouseInView: () => clientToView(surface, client),
      }),
  })

export const isTrackingPointer = (input: Input): boolean =>
  Stick.isAnyOf(['Active'])(input.moveStick) ||
  Stick.isAnyOf(['Active'])(input.aimStick) ||
  MouseButton.isAnyOf(['Held'])(input.mouseButton)

// INTENT

const stickDeflection = (stick: Stick): Vector =>
  Stick.match(stick, {
    Idle: () => ZERO_VECTOR,
    Active: ({ originX, originY, currentX, currentY }) =>
      clampLength(
        {
          x: (currentX - originX) / STICK_RADIUS_PX,
          y: (currentY - originY) / STICK_RADIUS_PX,
        },
        1,
      ),
  })

const withDeadZone = (deflection: Vector): Vector =>
  vectorLength(deflection) < STICK_DEAD_ZONE ? ZERO_VECTOR : deflection

const stickAim = (stick: Stick): Option.Option<Vector> =>
  pipe(stick, stickDeflection, withDeadZone, normalize)

const mouseAim = (
  input: Input,
  player: Player,
  camera: Camera,
): Option.Option<Vector> =>
  Option.flatMap(input.maybeMouseInView, mouseInView =>
    directionBetween(player, viewToWorld(camera, mouseInView)),
  )

// NOTE: a thumb on the aim stick pulls the trigger only once it is pushed
// past the fire zone. At the moment it lands the stick has no direction, so
// a shot then flew where the player last faced, not where they meant to aim.
const isAimStickFiring = (stick: Stick): boolean =>
  vectorLength(stickDeflection(stick)) >= STICK_FIRE_ZONE

const triggerOf = (input: Input): Trigger =>
  isAimStickFiring(input.aimStick) ||
  MouseButton.isAnyOf(['Held'])(input.mouseButton)
    ? 'Held'
    : 'Released'

const interactOf = (input: Input): Trigger =>
  Array.contains(input.pressedKeys, INTERACT_KEY) ||
  HoldButton.isAnyOf(['Held'])(input.holdButton)
    ? 'Held'
    : 'Released'

export const deriveIntent = (
  input: Input,
  player: Player,
  camera: Camera,
): Intent => ({
  move: clampLength(
    addVectors(
      keyboardMove(input.pressedKeys),
      pipe(input.moveStick, stickDeflection, withDeadZone),
    ),
    1,
  ),
  maybeAim: Option.orElse(stickAim(input.aimStick), () =>
    mouseAim(input, player, camera),
  ),
  trigger: triggerOf(input),
  interact: interactOf(input),
})

export const thumbOffset = (stick: Stick): Vector =>
  scaleVector(stickDeflection(stick), STICK_RADIUS_PX)
