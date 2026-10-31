import { Array, Option } from 'effect'

import { INTERACT_KEY } from './input'
import { isInteractTaken } from './purchase'
import { SeatAction } from './stepWorld'
import type { World } from './world'

// The keys that press a seat action (src/stepWorld.ts), in one table that
// single player, co-op's client, and the couch all read. Each seat names
// its own key for each action: player 1 the usual keys, a couch player a
// block of their own (src/couch.ts).

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
]

// NOTE: at a purchasable the interact key is held to buy (src/purchase.ts),
// so READY's key, the same key, starts nothing there. `seat` is the World
// as the pressing seat sees it.
const isTaken = (seat: World, key: keyof ActionKeys): boolean =>
  key === 'ready' && isInteractTaken(seat)

// NOTE: the seat action a key presses for a seat with these keys, if any.
export const keyActionOf = (
  seat: World,
  keys: ActionKeys,
  code: string,
): Option.Option<SeatAction> =>
  Option.map(
    Array.findFirst(
      ACTIONS,
      ([key]) => keys[key] === code && !isTaken(seat, key),
    ),
    ([, action]) => action,
  )

// NOTE: single player's and co-op's own seat: the usual keys.
export const playerKeyAction = (
  model: World,
  code: string,
): Option.Option<SeatAction> => keyActionOf(model, PLAYER_ACTION_KEYS, code)
