// The co-op Model's room, read and changed without a Command: element ids,
// room links and codes, members and the host, presses and tracers, and the
// lobby's picks. src/coop/update.ts wraps them in its Steps and Commands.

import { Array, Option, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Lobby,
  type LobbyMember,
  type PickedMode,
  type RoomDifficulty,
  Session,
  canHostPickNightmare,
  normalizeRoomCode,
} from '@munch/netcode'
import { CODE_ALPHABET } from '@munch/sync-engine'

import { actionCodeOf, heldAction } from '../roomWorld'
import type { SeatAction } from '../stepWorld'
import type { Bullet } from '../worldSchema'
import {
  type CoopProblem,
  type Model,
  type Presses,
  type Room,
  Screen,
  noPresses,
  screenInRoom,
} from './model'
import type { OwnPlayer } from './seam'

// IDS

export const QUICK_PLAY_BUTTON_ID = 'coop-quick'
export const CODE_INPUT_ID = 'coop-code'
export const READY_BUTTON_ID = 'coop-ready'
export const CALLING_PILL_ID = 'coop-calling-pill'
export const ROOM_CODE_LENGTH = 5

export const ROOM_PARAM = 'room'

export const linkOf = (code: string): string => {
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set(ROOM_PARAM, code)
  return url.toString()
}

// NOTE: the code a `?room=` link carries, read once as the game boots.
export const readRoomLink = (search: string): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(search).get(ROOM_PARAM)),
    normalizeRoomCode,
  )

export const withScreen = (model: Model, screen: Screen): Model =>
  modifyFields(model, { screen: () => screen })

export const hub = (
  model: Model,
  maybeProblem: Option.Option<CoopProblem>,
): Model => withScreen(model, Screen.Hub({ maybeProblem }))

export const freshRoom = (code: string, slot: number): Room => ({
  code,
  slot,
  maybePlayerId: Option.none(),
  maybeLobby: Option.none(),
  link: 'Connecting',
  droppedAtMs: Option.none(),
  session: Session.makeSession(0),
  maybeWorld: Option.none(),
  frameEvents: [],
  eventsTick: 0,
  predictedShots: 0,
  tracers: [],
  tracerCount: 0,
  hits: { looked: 0, confirmed: 0 },
  presses: noPresses,
  share: 'Idle',
  codeCopies: 0,
  departure: 'Staying',
  isPickingCalling: false,
})

const isCodeSymbol = (symbol: string): boolean =>
  String.includes(symbol)(CODE_ALPHABET)

// NOTE: what a player types or pastes, kept to the pairing alphabet: any
// case, a pasted link or spaces and dashes dropped, five symbols at most.
export const cleanCode = (typed: string): string => {
  const fromLink = Option.getOrElse(readRoomLinkOf(typed), () => typed)
  return pipe(
    globalThis.Array.from(fromLink.toUpperCase()),
    Array.filter(isCodeSymbol),
    Array.take(ROOM_CODE_LENGTH),
    Array.join(''),
  )
}

const readRoomLinkOf = (typed: string): Option.Option<string> =>
  String.includes('?')(typed)
    ? readRoomLink(typed.slice(typed.indexOf('?')))
    : Option.none()

const memberAt = (lobby: Lobby, slot: number): Option.Option<LobbyMember> =>
  Array.findFirst(lobby.members, member => member.slot === slot)

export const meIn = (room: Room): Option.Option<LobbyMember> =>
  Option.flatMap(
    Option.all([room.maybeLobby, room.maybePlayerId]),
    ([lobby, id]) =>
      Array.findFirst(lobby.members, member => member.playerId === id),
  )

export const isHost = (room: Room): boolean =>
  Option.exists(
    Option.all([room.maybeLobby, room.maybePlayerId]),
    ([lobby, id]) => lobby.host === id,
  )

export const withRoom = (model: Model, room: Room): Model =>
  withScreen(model, screenInRoom(room))

export const learnLobby = (room: Room, lobby: Lobby): Room => {
  const maybePlayerId = Option.orElse(room.maybePlayerId, () =>
    Option.map(memberAt(lobby, room.slot), member => member.playerId),
  )
  return { ...room, maybeLobby: Option.some(lobby), maybePlayerId }
}

export const isKickedFrom = (room: Room, lobby: Lobby): boolean =>
  Option.exists(
    room.maybePlayerId,
    id => !Array.some(lobby.members, member => member.playerId === id),
  )

// NOTE: the next queued press takes over the held value once the one held
// now has gone out on at least one input tick.
export const pressFor = (presses: Presses, inputTick: number): Presses =>
  Array.match(presses.queued, {
    onEmpty: () => presses,
    onNonEmpty: ([next, ...rest]) =>
      presses.held === 0 || inputTick > presses.heldFrom
        ? {
            queued: rest,
            held: heldAction(next, presses.presses + 1),
            presses: presses.presses + 1,
            heldFrom: inputTick + 1,
          }
        : presses,
  })

// NOTE: events are counted from the tick the last frame reached. A room that
// started its ticks again, a new run, counts from what it holds.
export const startOfEvents = (room: Room, frames: Room['session']['frames']) =>
  Option.match(Array.last(frames), {
    onNone: () => room.eventsTick,
    onSome: newest =>
      room.eventsTick > newest.tick
        ? Option.match(Array.head(frames), {
            onNone: () => 0,
            onSome: oldest => oldest.tick,
          })
        : room.eventsTick,
  })

// NOTE: a shot resets the recoil to its full length, and no gun fires
// twice in one frame's ticks, so a recoil higher than before is a shot.
export const shotsBetween = (
  maybeBefore: Option.Option<OwnPlayer>,
  maybeAfter: Option.Option<OwnPlayer>,
): number =>
  Option.exists(
    Option.all([maybeBefore, maybeAfter]),
    ([before, after]) =>
      after.player.recoilRemainingMs > before.player.recoilRemainingMs,
  )
    ? 1
    : 0

// NOTE: this frame's own tracers, kept for the next, and how many were ever
// fired, so each has its own id.
export const keepTracers = (
  model: Model,
  tracers: ReadonlyArray<Bullet>,
  fired: number,
  looked: number,
  confirmed: number,
): Model =>
  Option.match(maybeRoomOf(model), {
    onNone: () => model,
    onSome: room =>
      withRoom(model, {
        ...room,
        tracers,
        tracerCount: room.tracerCount + fired,
        hits: {
          looked: room.hits.looked + looked,
          confirmed: room.hits.confirmed + confirmed,
        },
      }),
  })

// NOTE: a press for the room: a swap, a buy, READY, and the rest
// (src/stepWorld.ts, SeatAction). It goes out with the next inputs.
export const pressAction = (model: Model, action: SeatAction): Model =>
  Option.match(maybeRoomOf(model), {
    onNone: () => model,
    onSome: room =>
      withRoom(model, {
        ...room,
        presses: {
          ...room.presses,
          queued: Array.append(room.presses.queued, actionCodeOf(action)),
        },
      }),
  })

// PICKS

export const MODE_PICKS: Array.NonEmptyReadonlyArray<PickedMode> = [
  'Campaign',
  'Endless',
  'KeepGoing',
]

export const pickedModeOf = (lobby: Lobby): PickedMode =>
  lobby.mode === 'StandIn' ? 'Campaign' : lobby.mode

// NOTE: KeepGoing is there only while the room keeps a won run, and
// Nightmare only for a host the room found it unlocked for, on the server
// (packages/netcode, Lobby.ts, canHostPickNightmare).
export const canPickMode = (lobby: Lobby, mode: PickedMode): boolean =>
  mode !== 'KeepGoing' || lobby.canKeepGoing

export const canPickDifficulty = (
  lobby: Lobby,
  difficulty: RoomDifficulty,
): boolean => difficulty !== 'Nightmare' || canHostPickNightmare(lobby)

export const isPicking = (room: Room): boolean =>
  isHost(room) &&
  Option.exists(room.maybeLobby, lobby => lobby.status === 'Lobby')

export const nextOf = <A>(
  all: Array.NonEmptyReadonlyArray<A>,
  current: A,
  isAllowed: (value: A) => boolean,
): A => {
  const at = Option.getOrElse(
    Array.findFirstIndex(all, value => value === current),
    () => 0,
  )
  return Option.getOrElse(
    Array.findFirst(
      Array.makeBy(all.length - 1, step =>
        Option.getOrElse(
          Array.get(all, (at + step + 1) % all.length),
          () => current,
        ),
      ),
      isAllowed,
    ),
    () => current,
  )
}

export const ESCAPE = 'Escape'
export const ENTER = 'Enter'
export const MODE_KEY = 'KeyE'
export const DIFFICULTY_KEY = 'KeyX'
export const CALLING_KEY = 'KeyY'

export const isInLobby = (room: Room): boolean =>
  Option.match(room.maybeLobby, {
    onNone: () => true,
    onSome: lobby => lobby.status === 'Lobby',
  })

export const maybeRoomOf = (model: Model): Option.Option<Room> =>
  Screen.match(model.screen, {
    Closed: () => Option.none(),
    Hub: () => Option.none(),
    Code: () => Option.none(),
    Asking: () => Option.none(),
    Queue: () => Option.none(),
    InRoom: ({ room }) => Option.some(room),
  })
