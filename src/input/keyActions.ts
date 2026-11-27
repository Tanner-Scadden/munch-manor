import { Array, Function, Option, Schema, pipe } from 'effect'

import { focusSlotOf, isDowned, seatStateAt } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import { isInteractTaken } from '#world/shop/purchase.ts'
import { SeatAction, cycleWeaponAction } from '#world/step/stepWorld.ts'

import {
  PAD_A,
  PAD_B,
  PAD_LB,
  PAD_LT,
  PAD_RB,
  PAD_X,
  PAD_Y,
  type PadDirection,
} from './gamepad.ts'

export const INTERACT_KEY = 'Enter'

export type ActionKeys = Readonly<{
  swap: string
  swapCycles: boolean
  knife: string
  reload: string
  placeTrap: string
  nextTrap: string
  ready: string
}>

const PLAYER_ACTION_KEYS: ActionKeys = {
  swap: 'KeyQ',
  swapCycles: false,
  knife: 'KeyF',
  reload: 'KeyR',
  placeTrap: 'KeyT',
  nextTrap: 'KeyG',
  ready: INTERACT_KEY,
}

const PAD_ACTION_KEYS: ActionKeys = {
  swap: PAD_Y,
  swapCycles: true,
  knife: PAD_B,
  reload: PAD_X,
  placeTrap: PAD_LT,
  nextTrap: PAD_LB,
  ready: PAD_A,
}

const ACTIONS: ReadonlyArray<readonly [keyof ActionKeys, SeatAction]> = [
  ['ready', SeatAction.CallMedic()],
  ['swap', SeatAction.Swap()],
  ['knife', SeatAction.Melee()],
  ['reload', SeatAction.Reload()],
  ['placeTrap', SeatAction.PlaceTrap()],
  ['nextTrap', SeatAction.NextTrap()],
  ['ready', SeatAction.Ready()],
]

const SLOT_KEYS: ReadonlyArray<readonly [string, SeatAction]> = [
  ['Digit1', SeatAction.Draw({ slot: 'First' })],
  ['Numpad1', SeatAction.Draw({ slot: 'First' })],
  ['Digit2', SeatAction.Draw({ slot: 'Second' })],
  ['Numpad2', SeatAction.Draw({ slot: 'Second' })],
  ['Digit3', SeatAction.Melee()],
  ['Numpad3', SeatAction.Melee()],
]

const slotKeyAction = (code: string): Option.Option<SeatAction> =>
  Option.map(
    Array.findFirst(SLOT_KEYS, ([key]) => key === code),
    ([, action]) => action,
  )

const isOpenTo = (seat: World, action: SeatAction): boolean =>
  SeatAction.matchOrElse(
    action,
    {
      CallMedic: () => isDowned(seatStateAt(seat, focusSlotOf(seat)).seat),
      Ready: () => !isInteractTaken(seat, focusSlotOf(seat)),
    },
    () => true,
  )

export const keyActionOf: {
  (keys: ActionKeys, code: string): (seat: World) => Option.Option<SeatAction>
  (seat: World, keys: ActionKeys, code: string): Option.Option<SeatAction>
} = Function.dual(
  3,
  (seat: World, keys: ActionKeys, code: string): Option.Option<SeatAction> =>
    Option.map(
      Array.findFirst(
        ACTIONS,
        ([key, action]) => keys[key] === code && isOpenTo(seat, action),
      ),
      ([key, action]) =>
        key === 'swap' && keys.swapCycles
          ? cycleWeaponAction(seatStateAt(seat, focusSlotOf(seat)).player)
          : action,
    ),
)

export const playerKeyAction: {
  (code: string): (model: World) => Option.Option<SeatAction>
  (model: World, code: string): Option.Option<SeatAction>
} = Function.dual(2, (model: World, code: string): Option.Option<SeatAction> =>
  pipe(
    keyActionOf(model, PLAYER_ACTION_KEYS, code),
    Option.orElse(() => keyActionOf(model, PAD_ACTION_KEYS, code)),
    Option.orElse(() => slotKeyAction(code)),
  ),
)

export const PadMenuPress = Schema.Literals([
  'Accept',
  'Back',
  'PreviousTab',
  'NextTab',
])
export type PadMenuPress = typeof PadMenuPress.Type

const PAD_MENU_KEYS: ReadonlyArray<readonly [string, PadMenuPress]> = [
  [PAD_A, 'Accept'],
  [PAD_B, 'Back'],
  [PAD_LB, 'PreviousTab'],
  [PAD_RB, 'NextTab'],
]

export const padMenuPressOf = (code: string): Option.Option<PadMenuPress> =>
  Option.map(
    Array.findFirst(PAD_MENU_KEYS, ([key]) => key === code),
    ([, press]) => press,
  )

export const DIRECTION_KEYS: Readonly<Record<PadDirection, string>> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
}

export const ACCEPT_KEY = 'Enter'
export const BACK_KEY = 'Escape'
