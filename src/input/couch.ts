import { Array, Function, Option, Record, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import { notePress } from '../platform/recording'
import {
  focusSeat,
  isBledOut,
  isOut,
  leadSeatOf,
  playersOf,
} from '../world/party/party'
import { withWorld } from '../world/schema/world'
import {
  type Intent,
  type PlayerSlot,
  type Vector,
} from '../world/schema/worldSchema'
import { ZERO_VECTOR, normalize } from '../world/step/geometry'
import { type InputsByPlayer, applySeatAction } from '../world/step/stepWorld'
import { isRoundActive } from '../world/waves/waves'
import { type ActionKeys, keyActionOf } from './keyActions'

// Local co-op for testing (MULTIPLAYER.md, Phase 1): with a dev-only
// `?local=N` link, players 2 to 4 share the keyboard with player 1, who
// keeps WASD, the mouse, and every usual key. Each other player has a
// block of keys of their own; they aim where they walk. Their READY key is
// their interact key too: held at a purchasable, it buys.

type CouchKeys = ActionKeys &
  Readonly<{
    up: string
    down: string
    left: string
    right: string
    fire: string
  }>

const COUCH_KEYS: ReadonlyMap<PlayerSlot, CouchKeys> = new Map([
  [
    1,
    {
      up: 'KeyI',
      down: 'KeyK',
      left: 'KeyJ',
      right: 'KeyL',
      fire: 'KeyU',
      knife: 'KeyB',
      swap: 'KeyO',
      reload: 'KeyP',
      placeTrap: 'KeyM',
      nextTrap: 'KeyN',
      ready: 'KeyY',
    },
  ],
  [
    2,
    {
      up: 'Numpad8',
      down: 'Numpad5',
      left: 'Numpad4',
      right: 'Numpad6',
      fire: 'Numpad7',
      knife: 'Numpad3',
      swap: 'Numpad9',
      reload: 'NumpadAdd',
      placeTrap: 'Numpad1',
      nextTrap: 'Numpad2',
      ready: 'NumpadEnter',
    },
  ],
  [
    3,
    {
      up: 'ArrowUp',
      down: 'ArrowDown',
      left: 'ArrowLeft',
      right: 'ArrowRight',
      fire: 'ShiftRight',
      knife: 'Backslash',
      swap: 'Slash',
      reload: 'Period',
      placeTrap: 'Comma',
      nextTrap: 'Semicolon',
      ready: 'Quote',
    },
  ],
])

export const isCouchPlay = (model: Model): boolean =>
  model.localPlayers > 1 && playersOf(model).length > 1

const couchSlots = (model: Model): ReadonlyArray<PlayerSlot> =>
  Array.filter(
    Array.map(playersOf(model), ({ seat }) => seat.slot),
    slot => COUCH_KEYS.has(slot),
  )

// INTENT

const axis = (
  keys: ReadonlyArray<string>,
  negative: string,
  positive: string,
) =>
  (Array.contains(keys, positive) ? 1 : 0) -
  (Array.contains(keys, negative) ? 1 : 0)

const moveOf = (keys: ReadonlyArray<string>, couch: CouchKeys): Vector =>
  pipe(
    {
      x: axis(keys, couch.left, couch.right),
      y: axis(keys, couch.up, couch.down),
    },
    normalize,
    Option.getOrElse(() => ZERO_VECTOR),
  )

const intentOf = (model: Model, couch: CouchKeys): Intent => {
  const keys = model.input.pressedKeys
  return {
    move: moveOf(keys, couch),
    maybeAim: Option.none(),
    trigger: Array.contains(keys, couch.fire) ? 'Held' : 'Released',
    interact: Array.contains(keys, couch.ready) ? 'Held' : 'Released',
  }
}

// NOTE: every player's intent for a tick: player 1's from the client's own
// input and camera, the rest from their keys.
export const couchInputs: {
  (leadIntent: Intent): (model: Model) => InputsByPlayer
  (model: Model, leadIntent: Intent): InputsByPlayer
} = Function.dual(
  2,
  (model: Model, leadIntent: Intent): InputsByPlayer =>
    new Map([
      [leadSeatOf(model).slot, leadIntent],
      ...Array.filterMap(couchSlots(model), slot =>
        Option.match(Option.fromNullishOr(COUCH_KEYS.get(slot)), {
          onNone: () => Result.failVoid,
          onSome: couch =>
            Result.succeed([slot, intentOf(model, couch)] as const),
        }),
      ),
    ]),
)

// PRESSES

type CouchPress = Readonly<{ slot: PlayerSlot; couch: CouchKeys }>

const maybePressOf = (model: Model, code: string): Option.Option<CouchPress> =>
  pipe(
    couchSlots(model),
    Array.findFirst(slot =>
      Option.exists(Option.fromNullishOr(COUCH_KEYS.get(slot)), couch =>
        Record.values(couch).includes(code),
      ),
    ),
    Option.flatMap(slot =>
      Option.map(Option.fromNullishOr(COUCH_KEYS.get(slot)), couch => ({
        slot,
        couch,
      })),
    ),
  )

export const isCouchKey: {
  (code: string): (model: Model) => boolean
  (model: Model, code: string): boolean
} = Function.dual(
  2,
  (model: Model, code: string): boolean =>
    isCouchPlay(model) &&
    isRoundActive(model.phase) &&
    Option.isSome(maybePressOf(model, code)),
)

const fieldPress = (
  model: Model,
  { slot, couch }: CouchPress,
  code: string,
): Model =>
  Option.match(keyActionOf(focusSeat(model, slot), couch, code), {
    onNone: () => model,
    onSome: action =>
      modifyFields(
        withWorld(model, world => applySeatAction(world, slot, action)),
        { recorder: notePress(slot, action) },
      ),
  })

// NOTE: a couch player's key, held for their intent and applied as their
// seat's action.
export const pressCouchKey: {
  (code: string): (model: Model) => Model
  (model: Model, code: string): Model
} = Function.dual(2, (model: Model, code: string): Model =>
  Option.match(maybePressOf(model, code), {
    onNone: () => model,
    onSome: press => fieldPress(model, press, code),
  }),
)

// CAMERA

// NOTE: one screen for everyone at the keyboard: the camera follows the
// middle of every player still in the fight, in the house.
export const couchFocus = (model: Model): Option.Option<Vector> => {
  if (!isCouchPlay(model)) {
    return Option.none()
  }
  const players = Array.filter(
    playersOf(model),
    ({ seat }) => !isBledOut(seat) && !isOut(seat),
  )
  return Array.match(players, {
    onEmpty: () => Option.none(),
    onNonEmpty: present =>
      Option.some({
        x:
          Array.reduce(present, 0, (sum, { player }) => sum + player.x) /
          present.length,
        y:
          Array.reduce(present, 0, (sum, { player }) => sum + player.y) /
          present.length,
      }),
  })
}
