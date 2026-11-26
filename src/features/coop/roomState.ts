import { Array, Function, Option, String, pipe } from 'effect'

import { UiStruct } from '@effect/ui'
import { Html } from '@effect/ui/html'
import {
  CODE_ALPHABET,
  type Lobby,
  type LobbyMember,
  type PickedMode,
  type RoomDifficulty,
  Session,
  canHostPickNightmare,
  normalizeRoomCode,
} from '@munch/netcode'

import {
  type CoopProblem,
  type OwnPlayer,
  type Presses,
  type Room,
  Screen,
  maybeRoomOf,
  noPresses,
} from '../../domain/coopRoom'
import { actionCodeOf, heldAction } from '../../world/net/roomWorld'
import type { Bullet } from '../../world/schema/worldSchema'
import type { SeatAction } from '../../world/step/stepWorld'
import { type Model } from './model'

export const QUICK_PLAY_BUTTON_ID = 'coop-quick'
export const CODE_INPUT_ID = 'coop-code'
export const READY_BUTTON_ID = 'coop-ready'
export const CALLING_PILL_ID = 'coop-calling-pill'
export const NAME_BUTTON_ID = 'coop-name-button'
export const NAME_INPUT_ID = 'coop-name-input'
export const ROOM_CODE_LENGTH = 5

export const QUICK_PLAY_BUTTON = Html.ref(QUICK_PLAY_BUTTON_ID, 'button')
export const CODE_INPUT = Html.ref(CODE_INPUT_ID, 'input')
export const READY_BUTTON = Html.ref(READY_BUTTON_ID, 'button')
export const CALLING_PILL = Html.ref(CALLING_PILL_ID, 'button')
export const NAME_BUTTON = Html.ref(NAME_BUTTON_ID, 'button')
export const NAME_INPUT = Html.ref(NAME_INPUT_ID, 'input')

export type CoopFocus =
  | 'QuickPlay'
  | 'Code'
  | 'Ready'
  | 'CallingPill'
  | 'NameButton'
  | 'NameInput'

export const ROOM_PARAM = 'room'

export const linkOf = (code: string): string => {
  const url = new URL(import.meta.env.VITE_ROOM_LINK_BASE ?? location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set(ROOM_PARAM, code)
  return url.toString()
}

export const readRoomLink = (search: string): Option.Option<string> =>
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(search).get(ROOM_PARAM)),
    normalizeRoomCode,
  )

export const withScreen: {
  (screen: Screen): (model: Model) => Model
  (model: Model, screen: Screen): Model
} = Function.dual(2, (model: Model, screen: Screen): Model =>
  UiStruct.evolve(model, { screen: () => screen }),
)

export const hub: {
  (maybeProblem: Option.Option<CoopProblem>): (model: Model) => Model
  (model: Model, maybeProblem: Option.Option<CoopProblem>): Model
} = Function.dual(
  2,
  (model: Model, maybeProblem: Option.Option<CoopProblem>): Model =>
    withScreen(model, Screen.Hub({ maybeProblem })),
)

export const freshRoom: {
  (slot: number): (code: string) => Room
  (code: string, slot: number): Room
} = Function.dual(2, (code: string, slot: number): Room => ({
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
  maybeNameDraft: Option.none(),
  maybeNudge: Option.none(),
}))

const isCodeSymbol = (symbol: string): boolean =>
  String.includes(symbol)(CODE_ALPHABET)

export const cleanCode = (typed: string): string => {
  const fromLink = Option.getOrElse(readRoomLinkOf(typed), () => typed)
  return pipe(
    globalThis.Array.from(String.toUpperCase(fromLink)),
    Array.filter(isCodeSymbol),
    Array.take(ROOM_CODE_LENGTH),
    Array.join(''),
  )
}

const readRoomLinkOf = (typed: string): Option.Option<string> =>
  pipe(
    String.indexOf('?')(typed),
    Option.flatMap(at => readRoomLink(String.slice(at)(typed))),
  )

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

export const withRoom: {
  (room: Room): (model: Model) => Model
  (model: Model, room: Room): Model
} = Function.dual(2, (model: Model, room: Room): Model =>
  withScreen(model, Screen.InRoom({ room })),
)

export const learnLobby: {
  (lobby: Lobby): (room: Room) => Room
  (room: Room, lobby: Lobby): Room
} = Function.dual(2, (room: Room, lobby: Lobby): Room => {
  const maybePlayerId = Option.orElse(room.maybePlayerId, () =>
    Option.map(memberAt(lobby, room.slot), member => member.playerId),
  )
  return { ...room, maybeLobby: Option.some(lobby), maybePlayerId }
})

export const isKickedFrom: {
  (lobby: Lobby): (room: Room) => boolean
  (room: Room, lobby: Lobby): boolean
} = Function.dual(2, (room: Room, lobby: Lobby): boolean =>
  Option.exists(
    room.maybePlayerId,
    id => !Array.some(lobby.members, member => member.playerId === id),
  ),
)

export const pressFor: {
  (inputTick: number): (presses: Presses) => Presses
  (presses: Presses, inputTick: number): Presses
} = Function.dual(2, (presses: Presses, inputTick: number): Presses =>
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
  }),
)

export const startOfEvents: {
  (frames: Room['session']['frames']): (room: Room) => number
  (room: Room, frames: Room['session']['frames']): number
} = Function.dual(2, (room: Room, frames: Room['session']['frames']): number =>
  Option.match(Array.last(frames), {
    onNone: () => room.eventsTick,
    onSome: newest =>
      room.eventsTick > newest.tick
        ? Option.match(Array.head(frames), {
            onNone: () => 0,
            onSome: oldest => oldest.tick,
          })
        : room.eventsTick,
  }),
)

export const shotsBetween: {
  (
    maybeAfter: Option.Option<OwnPlayer>,
  ): (maybeBefore: Option.Option<OwnPlayer>) => number
  (
    maybeBefore: Option.Option<OwnPlayer>,
    maybeAfter: Option.Option<OwnPlayer>,
  ): number
} = Function.dual(
  2,
  (
    maybeBefore: Option.Option<OwnPlayer>,
    maybeAfter: Option.Option<OwnPlayer>,
  ): number =>
    Option.exists(
      Option.all([maybeBefore, maybeAfter]),
      ([before, after]) =>
        after.player.recoilRemainingMs > before.player.recoilRemainingMs,
    )
      ? 1
      : 0,
)

export const keepTracers: {
  (
    tracers: ReadonlyArray<Bullet>,
    fired: number,
    looked: number,
    confirmed: number,
  ): (model: Model) => Model
  (
    model: Model,
    tracers: ReadonlyArray<Bullet>,
    fired: number,
    looked: number,
    confirmed: number,
  ): Model
} = Function.dual(
  5,
  (
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
    }),
)

export const pressAction: {
  (action: SeatAction): (model: Model) => Model
  (model: Model, action: SeatAction): Model
} = Function.dual(2, (model: Model, action: SeatAction): Model =>
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
  }),
)

export const MODE_PICKS: Array.NonEmptyReadonlyArray<PickedMode> = [
  'Campaign',
  'Endless',
  'KeepGoing',
]

export const pickedModeOf = (lobby: Lobby): PickedMode =>
  lobby.mode === 'StandIn' ? 'Campaign' : lobby.mode

export const canPickMode: {
  (mode: PickedMode): (lobby: Lobby) => boolean
  (lobby: Lobby, mode: PickedMode): boolean
} = Function.dual(
  2,
  (lobby: Lobby, mode: PickedMode): boolean =>
    mode !== 'KeepGoing' || lobby.canKeepGoing,
)

export const canPickDifficulty: {
  (difficulty: RoomDifficulty): (lobby: Lobby) => boolean
  (lobby: Lobby, difficulty: RoomDifficulty): boolean
} = Function.dual(
  2,
  (lobby: Lobby, difficulty: RoomDifficulty): boolean =>
    difficulty !== 'Nightmare' || canHostPickNightmare(lobby),
)

export const isPicking = (room: Room): boolean =>
  isHost(room) &&
  Option.exists(room.maybeLobby, lobby => lobby.status === 'Lobby')

export const nextOf: {
  <A>(
    current: A,
    isAllowed: (value: A) => boolean,
  ): (all: Array.NonEmptyReadonlyArray<A>) => A
  <A>(
    all: Array.NonEmptyReadonlyArray<A>,
    current: A,
    isAllowed: (value: A) => boolean,
  ): A
} = Function.dual(
  3,
  <A>(
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
  },
)

export const ESCAPE = 'Escape'
export const ENTER = 'Enter'
export const MODE_KEY = 'KeyE'
export const DIFFICULTY_KEY = 'KeyX'
export const CALLING_KEY = 'KeyY'
