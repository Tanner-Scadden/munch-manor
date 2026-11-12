import { Array, Function, Option, Schema, pipe } from 'effect'

import { focusSlotOf, isDowned, seatStateAt } from '../world/party/party'
import type { World } from '../world/schema/world'
import { isInteractTaken } from '../world/shop/purchase'
import { SeatAction, cycleWeaponAction } from '../world/step/stepWorld'
import {
  PAD_A,
  PAD_B,
  PAD_LB,
  PAD_LT,
  PAD_RB,
  PAD_X,
  PAD_Y,
  type PadDirection,
} from './gamepad'

// The keys that press a seat action (src/world/step/stepWorld.ts), in one table that
// single player, co-op's client, and the couch all read. Each seat names
// its own key for each action: player 1 the usual keys, a couch player a
// block of their own (src/input/couch.ts), and a controller its buttons
// (src/input/gamepad.ts).

// NOTE: held to buy at a purchasable (src/world/shop/purchase.ts), pressed for
// READY elsewhere, and while downed, MEDIC!
export const INTERACT_KEY = 'Enter'

// NOTE: swapCycles makes the swap key step through all three slots, the
// knife too, one way (cycleWeaponAction), as a controller's Y does.
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

// NOTE: a controller's fixed layout (docs/INPUT_PLAN.md): A is the
// interact button, X reloads, Y cycles gun, gun, knife (owner, 2026-11-12),
// B draws the knife outright, LT places a trap and LB picks the next. Pads
// are never rebound.
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

// NOTE: the number keys pick a slot outright: 1 and 2 a gun, 3 the melee
// slot, as F does. Player 1's alone: a couch player's own block takes the
// numpad's in couch play, ahead of these (src/app/update/play.ts).
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

// NOTE: at a purchasable the interact key is held to buy (src/world/shop/purchase.ts),
// so READY's key, the same key, starts nothing there. While downed it
// shouts MEDIC! and nothing else, even while the last shout cools down. `seat` is the World as the
// pressing seat sees it.
const isOpenTo = (seat: World, action: SeatAction): boolean =>
  SeatAction.matchOrElse(
    action,
    {
      CallMedic: () => isDowned(seatStateAt(seat, focusSlotOf(seat)).seat),
      Ready: () => !isInteractTaken(seat, focusSlotOf(seat)),
    },
    () => true,
  )

// NOTE: the seat action a key presses for a seat with these keys, if any.
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

// NOTE: single player's and co-op's own seat: the usual keys, a
// controller's buttons, and the number keys.
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

// MENUS

// NOTE: what a controller presses in a menu (src/app/update/padMenu.ts):
// A clicks what has focus, B backs out as Escape does, and the bumpers
// turn tabs and pages. Pads are never rebound, so this is fixed too.
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

// NOTE: the arrow key a pad's direction is, for the menus that step their
// own focus by arrows (the home menu, the lobby).
export const DIRECTION_KEYS: Readonly<Record<PadDirection, string>> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
}

// NOTE: the keyboard key a menu press stands for on a screen that reads
// keys itself: Enter when nothing has focus, Escape to back out.
export const ACCEPT_KEY = 'Enter'
export const BACK_KEY = 'Escape'
