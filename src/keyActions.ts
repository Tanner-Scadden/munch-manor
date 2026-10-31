import { Array, Option } from 'effect'

import { isInteractTaken, maybeTapOffer } from './purchase'
import { SeatAction } from './stepWorld'
import type { World } from './world'

// The keys that press a seat action (src/stepWorld.ts), in one table that
// single player, co-op's client, and the couch all read. Each seat names
// its own key for each action: player 1 the usual keys, a couch player a
// block of their own (src/couch.ts).

// NOTE: held to buy at a purchasable (src/purchase.ts), pressed to buy at
// the ammo window, and pressed for READY elsewhere.
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
  ['swap', SeatAction.Swap()],
  ['knife', SeatAction.Melee()],
  ['reload', SeatAction.Reload()],
  ['placeTrap', SeatAction.PlaceTrap()],
  ['nextTrap', SeatAction.NextTrap()],
  ['ready', SeatAction.Ready()],
  ['ready', SeatAction.BuyAmmo()],
]

// NOTE: at a purchasable the interact key is held to buy (src/purchase.ts),
// so READY's key, the same key, starts nothing there; at the ammo window a
// press of it buys at once. `seat` is the World as the pressing seat sees
// it.
const isOpenTo = (seat: World, action: SeatAction): boolean =>
  SeatAction.matchOrElse(
    action,
    {
      Ready: () => !isInteractTaken(seat),
      BuyAmmo: () => Option.isSome(maybeTapOffer(seat)),
    },
    () => true,
  )

// NOTE: the seat action a key presses for a seat with these keys, if any.
export const keyActionOf = (
  seat: World,
  keys: ActionKeys,
  code: string,
): Option.Option<SeatAction> =>
  Option.map(
    Array.findFirst(
      ACTIONS,
      ([key, action]) => keys[key] === code && isOpenTo(seat, action),
    ),
    ([, action]) => action,
  )

// NOTE: single player's and co-op's own seat: the usual keys.
export const playerKeyAction = (
  model: World,
  code: string,
): Option.Option<SeatAction> => keyActionOf(model, PLAYER_ACTION_KEYS, code)
