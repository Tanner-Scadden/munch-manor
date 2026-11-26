import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { type Camera, viewToWorld } from '../render/camera'
import { screenToFloorDirection } from '../render/lens'
import { clientToView, isLeftHalf } from '../render/screen'
import {
  CAMERA_LEAN_PX,
  MOUSE_LEAN_SHARE,
  STICK_DEAD_ZONE,
  STICK_FIRE_ZONE,
  STICK_RADIUS_PX,
} from '../shared/constants'
import * as DetMath from '../shared/detMath'
import type {
  Intent,
  Player,
  Trigger,
  Vector,
} from '../world/schema/entitySchema'
import {
  ZERO_VECTOR,
  addVectors,
  clampLength,
  directionBetween,
  normalize,
  scaleVector,
  vectorLength,
} from '../world/step/geometry'
import {
  PAD_SELECT,
  PAD_START,
  axis,
  isPadCode,
  isPadFiring,
  isPadInteracting,
  padAim,
  padAimReach,
  padMove,
} from './gamepad'
import {
  HoldButton,
  type Input,
  MouseButton,
  type PointerDevice,
  Stick,
  type SurfaceRectangle,
} from './inputSchema'
import { INTERACT_KEY } from './keyActions'

const UP_KEY = 'KeyW'
const DOWN_KEY = 'KeyS'
const LEFT_KEY = 'KeyA'
const RIGHT_KEY = 'KeyD'
const START_KEY = 'Enter'
const ENDLESS_KEY = 'KeyE'
const CHARACTER_KEY = 'KeyC'
const PAUSE_KEY = 'Escape'
const MENU_KEY = 'KeyH'
const LOBBY_KEY = 'KeyL'
const PREVIOUS_BUTTON_KEYS: ReadonlyArray<string> = ['ArrowLeft', 'ArrowUp']
const NEXT_BUTTON_KEYS: ReadonlyArray<string> = ['ArrowRight', 'ArrowDown']

export type FocusStep = 'Previous' | 'Next'

export const maybeFocusStep = (code: string): Option.Option<FocusStep> => {
  if (Array.contains(PREVIOUS_BUTTON_KEYS, code)) {
    return Option.some('Previous')
  } else if (Array.contains(NEXT_BUTTON_KEYS, code)) {
    return Option.some('Next')
  } else {
    return Option.none()
  }
}

export const FOCUS_STEP_OFFSET: Readonly<Record<FocusStep, number>> = {
  Previous: -1,
  Next: 1,
}

export const isMenuKey = (code: string): boolean =>
  code === MENU_KEY || code === PAD_SELECT

export const isLobbyKey = (code: string): boolean => code === LOBBY_KEY

export const isStartKey = (code: string): boolean => code === START_KEY

export const isEndlessKey = (code: string): boolean => code === ENDLESS_KEY

export const isCharacterKey = (code: string): boolean => code === CHARACTER_KEY

export const isPauseKey = (code: string): boolean =>
  code === PAUSE_KEY || code === PAD_START

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

export const pressKey: {
  (code: string): (input: Input) => Input
  (input: Input, code: string): Input
} = Function.dual(2, (input: Input, code: string): Input =>
  isPadCode(code)
    ? input
    : UiStruct.evolve(input, {
        pressedKeys: pressedKeys =>
          Array.contains(pressedKeys, code)
            ? pressedKeys
            : Array.append(pressedKeys, code),
      }),
)

export const releaseKey: {
  (code: string): (input: Input) => Input
  (input: Input, code: string): Input
} = Function.dual(2, (input: Input, code: string): Input =>
  UiStruct.evolve(input, {
    pressedKeys: Array.filter(pressedCode => pressedCode !== code),
  }),
)

export const releaseKeys = (input: Input): Input =>
  UiStruct.evolve(input, { pressedKeys: () => [] })

export const releaseAll = (input: Input): Input =>
  UiStruct.evolve(input, {
    pressedKeys: () => [],
    mouseButton: () => MouseButton.Released(),
    moveStick: () => Stick.Idle(),
    aimStick: () => Stick.Idle(),
    holdButton: () => HoldButton.Released(),
    firePress: () => 'Seen',
  })

export const seeFirePress = (input: Input): Input =>
  input.firePress === 'Seen'
    ? input
    : UiStruct.evolve(input, { firePress: () => 'Seen' })

const STICK_TOUCH_REACH_PX = 96

type TouchPoint = Readonly<{ clientX: number; clientY: number }>

const keepIfTouched = (
  stick: Stick,
  points: ReadonlyArray<TouchPoint>,
): Stick =>
  Stick.match(stick, {
    Idle: () => stick,
    Active: active =>
      Array.some(
        points,
        point =>
          DetMath.hypot(
            point.clientX - active.currentX,
            point.clientY - active.currentY,
          ) <= STICK_TOUCH_REACH_PX,
      )
        ? stick
        : Stick.Idle(),
  })

export const keepTouchedSticks: {
  (points: ReadonlyArray<TouchPoint>): (input: Input) => Input
  (input: Input, points: ReadonlyArray<TouchPoint>): Input
} = Function.dual(2, (input: Input, points: ReadonlyArray<TouchPoint>): Input =>
  UiStruct.evolve(input, {
    moveStick: stick => keepIfTouched(stick, points),
    aimStick: stick => keepIfTouched(stick, points),
  }),
)

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

const takeStick = (stick: Stick, press: PointerPress): Stick => {
  const pressed = Stick.Active({
    pointerId: press.pointerId,
    originX: press.clientX,
    originY: press.clientY,
    currentX: press.clientX,
    currentY: press.clientY,
  })
  return Stick.match(stick, {
    Idle: () => pressed,
    Active: active =>
      DetMath.hypot(
        press.clientX - active.originX,
        press.clientY - active.originY,
      ) <= STICK_RADIUS_PX
        ? pressed
        : stick,
  })
}

const pressTouch = (
  input: Input,
  surface: SurfaceRectangle,
  press: PointerPress,
): Input => {
  if (isLeftHalf(surface, press.clientX)) {
    return UiStruct.evolve(input, {
      moveStick: stick => takeStick(stick, press),
    })
  } else {
    return UiStruct.evolve(input, {
      aimStick: stick => takeStick(stick, press),
    })
  }
}

const pressMouse = (
  input: Input,
  surface: SurfaceRectangle,
  press: PointerPress,
): Input =>
  UiStruct.evolve(input, {
    mouseButton: () => MouseButton.Held({ pointerId: press.pointerId }),
    firePress: () => 'Waiting',
    maybeMouseInView: () =>
      clientToView(surface, { x: press.clientX, y: press.clientY }),
  })

export const pressPointer: {
  (
    maybeSurface: Option.Option<SurfaceRectangle>,
    press: PointerPress,
  ): (input: Input) => Input
  (
    input: Input,
    maybeSurface: Option.Option<SurfaceRectangle>,
    press: PointerPress,
  ): Input
} = Function.dual(
  3,
  (
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
    }),
)

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

const pushAimStick = (input: Input, aimStick: Stick): Input =>
  UiStruct.evolve(input, {
    aimStick: () => aimStick,
    firePress: firePress =>
      isAimStickFiring(aimStick) && !isAimStickFiring(input.aimStick)
        ? 'Waiting'
        : firePress,
  })

const isMouseHeldBy = (input: Input, pointerId: number): boolean =>
  MouseButton.match(input.mouseButton, {
    Released: () => false,
    Held: held => held.pointerId === pointerId,
  })

export const movePointer: {
  (
    maybeSurface: Option.Option<SurfaceRectangle>,
    position: PointerPosition,
  ): (input: Input) => Input
  (
    input: Input,
    maybeSurface: Option.Option<SurfaceRectangle>,
    position: PointerPosition,
  ): Input
} = Function.dual(
  3,
  (
    input: Input,
    maybeSurface: Option.Option<SurfaceRectangle>,
    position: PointerPosition,
  ): Input =>
    isMouseHeldBy(input, position.pointerId)
      ? moveMouse(input, maybeSurface, {
          x: position.clientX,
          y: position.clientY,
        })
      : pushAimStick(
          UiStruct.evolve(input, {
            moveStick: stick => moveStickPointer(stick, position),
          }),
          moveStickPointer(input.aimStick, position),
        ),
)

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

export const releasePointer: {
  (pointerId: number): (input: Input) => Input
  (input: Input, pointerId: number): Input
} = Function.dual(2, (input: Input, pointerId: number): Input =>
  UiStruct.evolve(input, {
    moveStick: stick => releaseStickPointer(stick, pointerId),
    aimStick: stick => releaseStickPointer(stick, pointerId),
    mouseButton: mouseButton => releaseMouseButton(mouseButton, pointerId),
    holdButton: holdButton => releaseHoldButton(holdButton, pointerId),
  }),
)

export const pressHoldButton: {
  (pointerId: number): (input: Input) => Input
  (input: Input, pointerId: number): Input
} = Function.dual(2, (input: Input, pointerId: number): Input =>
  UiStruct.evolve(input, {
    holdButton: holdButton =>
      HoldButton.match(holdButton, {
        Released: () => HoldButton.Held({ pointerId }),
        Held: () => holdButton,
      }),
  }),
)

export const moveMouse: {
  (
    maybeSurface: Option.Option<SurfaceRectangle>,
    client: Vector,
  ): (input: Input) => Input
  (
    input: Input,
    maybeSurface: Option.Option<SurfaceRectangle>,
    client: Vector,
  ): Input
} = Function.dual(
  3,
  (
    input: Input,
    maybeSurface: Option.Option<SurfaceRectangle>,
    client: Vector,
  ): Input =>
    Option.match(maybeSurface, {
      onNone: () => input,
      onSome: surface =>
        UiStruct.evolve(input, {
          maybeMouseInView: () => clientToView(surface, client),
        }),
    }),
)

export const isTrackingPointer = (input: Input): boolean =>
  Stick.isAnyOf(['Active'])(input.moveStick) ||
  Stick.isAnyOf(['Active'])(input.aimStick) ||
  MouseButton.isAnyOf(['Held'])(input.mouseButton)

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

export const aimReachOf: {
  (camera: Camera): (input: Input) => Option.Option<Vector>
  (input: Input, camera: Camera): Option.Option<Vector>
} = Function.dual(2, (input: Input, camera: Camera): Option.Option<Vector> =>
  pipe(
    Option.liftPredicate(
      withDeadZone(stickDeflection(input.aimStick)),
      reach => vectorLength(reach) > 0,
    ),
    Option.orElse(() => padAimReach(input.maybeGamepad)),
    Option.orElse(() =>
      Option.map(input.maybeMouseInView, mouse =>
        clampLength(
          scaleVector(
            {
              x: (mouse.x - camera.left) / camera.scale - camera.width / 2,
              y: (mouse.y - camera.top) / camera.scale - camera.height / 2,
            },
            MOUSE_LEAN_SHARE / CAMERA_LEAN_PX,
          ),
          1,
        ),
      ),
    ),
    Option.map(screenToFloorDirection),
  ),
)

const isAimStickFiring = (stick: Stick): boolean =>
  vectorLength(stickDeflection(stick)) >= STICK_FIRE_ZONE

const triggerOf = (input: Input): Trigger =>
  input.firePress === 'Waiting' ||
  isAimStickFiring(input.aimStick) ||
  MouseButton.isAnyOf(['Held'])(input.mouseButton) ||
  isPadFiring(input.maybeGamepad)
    ? 'Held'
    : 'Released'

const interactOf = (input: Input): Trigger =>
  Array.contains(input.pressedKeys, INTERACT_KEY) ||
  HoldButton.isAnyOf(['Held'])(input.holdButton) ||
  isPadInteracting(input.maybeGamepad)
    ? 'Held'
    : 'Released'

export const deriveIntent: {
  (player: Player, camera: Camera): (input: Input) => Intent
  (input: Input, player: Player, camera: Camera): Intent
} = Function.dual(
  3,
  (input: Input, player: Player, camera: Camera): Intent => ({
    move: screenToFloorDirection(
      clampLength(
        addVectors(
          addVectors(
            keyboardMove(input.pressedKeys),
            pipe(input.moveStick, stickDeflection, withDeadZone),
          ),
          padMove(input.maybeGamepad),
        ),
        1,
      ),
    ),
    maybeAim: pipe(
      stickAim(input.aimStick),
      Option.orElse(() => padAim(input.maybeGamepad)),
      Option.map(screenToFloorDirection),
      Option.orElse(() => mouseAim(input, player, camera)),
    ),
    trigger: triggerOf(input),
    interact: interactOf(input),
  }),
)

export const thumbOffset = (stick: Stick): Vector =>
  scaleVector(stickDeflection(stick), STICK_RADIUS_PX)
