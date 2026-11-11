import { Array, Function, Option } from 'effect'

import { focusSlotOf, isDowned, seatStateAt } from '../world/party/party'
import type { World } from '../world/schema/world'
import { isInteractTaken } from '../world/shop/purchase'
import { SeatAction } from '../world/step/stepWorld'

// The keys that press a seat action (src/world/step/stepWorld.ts), in one table that
// single player, co-op's client, and the couch all read. Each seat names
// its own key for each action: player 1 the usual keys, a couch player a
// block of their own (src/input/couch.ts).

// NOTE: held to buy at a purchasable (src/world/shop/purchase.ts), pressed for
// READY elsewhere, and while downed, MEDIC!
export const INTERACT_KEY = 'Enter'

export type ActionKeys = Readonly<{
  swap: string
  knife: string
  reload: string
  placeTrap: string
  nextTrap: string
  ready: string
}>

const PLAYER_ACTION_KEYS: ActionKeys = {
  swap: 'KeyQ',
  knife: 'KeyF',
  reload: 'KeyR',
  placeTrap: 'KeyT',
  nextTrap: 'KeyG',
  ready: INTERACT_KEY,
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
      ([, action]) => action,
    ),
)

// NOTE: single player's and co-op's own seat: the usual keys and the
// number keys.
export const playerKeyAction: {
  (code: string): (model: World) => Option.Option<SeatAction>
  (model: World, code: string): Option.Option<SeatAction>
} = Function.dual(2, (model: World, code: string): Option.Option<SeatAction> =>
  Option.orElse(keyActionOf(model, PLAYER_ACTION_KEYS, code), () =>
    slotKeyAction(code),
  ),
)
