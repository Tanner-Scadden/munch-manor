import { Option, Schema, SchemaTransformation } from 'effect'
import { State } from 'effect-machine'

import { UiSchema } from '@effect/ui'
import {
  Lobby,
  PickedMode,
  RoomCode,
  RoomDifficulty,
  Session,
  type World,
} from '@munch/netcode'

import { Calling } from '#shared/playerData.ts'
import {
  type OwnSeat,
  ROOM_WORLD,
  type RoomWorld,
} from '#world/net/roomWorld.ts'
import { Bullet, GameEvent } from '#world/schema/worldSchema.ts'

export type WorldState = RoomWorld
export type OwnPlayer = OwnSeat

export const coopWorld: World<WorldState, OwnPlayer> = ROOM_WORLD

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

export const RoomSession = Schema.declare(
  (value: unknown): value is Session.Session<WorldState, OwnPlayer> =>
    isObject(value) && 'phase' in value && 'frames' in value,
  {
    toCodecJson: () =>
      Schema.link<Session.Session<WorldState, OwnPlayer>>()(
        Schema.Null,
        SchemaTransformation.transform({
          decode: () => Session.makeSession<WorldState, OwnPlayer>(0),
          encode: () => null,
        }),
      ),
  },
)
export type RoomSession = typeof RoomSession.Type

export const WorldState = Schema.declare(
  (value: unknown): value is WorldState =>
    isObject(value) && 'tick' in value && 'world' in value,
)

export const CoopProblem = Schema.Literals([
  'Offline',
  'NoRoom',
  'Full',
  'Started',
  'Busy',
  'NotACode',
  'Kicked',
  'Dropped',
  'Outdated',
])
export type CoopProblem = typeof CoopProblem.Type

export const LobbyChange = UiSchema.TaggedEnum({
  ChangedReady: { ready: Schema.Boolean, pingMs: Schema.Finite },
  ChangedPicks: { mode: PickedMode, difficulty: RoomDifficulty },
  ChangedModifiers: { modifiers: Schema.Finite },
  ChangedEasyBreak: { seconds: Schema.Finite },
  ChangedDareMark: { mark: Schema.Finite },
  ChangedMemberCalling: { calling: Calling },
  ChangedMemberName: { name: Schema.String },
  KickedPlayer: { playerId: Schema.String },
})
export type LobbyChange = typeof LobbyChange.Type

export const RoomRequest = UiSchema.TaggedEnum({
  Create: {},
  Join: { code: RoomCode },
})
export type RoomRequest = typeof RoomRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Finite })
export type RoomTicket = typeof RoomTicket.Type

export const OfferAnswer = Schema.Literals([
  'Unanswered',
  'Accepted',
  'Waiting',
])
export type OfferAnswer = typeof OfferAnswer.Type

export const Queue = Schema.Struct({
  names: Schema.Array(Schema.String),
  waiting: Schema.Finite,
  position: Schema.Finite,
  groupSize: Schema.Finite,
  offerPlayers: Schema.Finite,
  accepted: Schema.Finite,
  answer: OfferAnswer,
})
export type Queue = typeof Queue.Type

const Link = Schema.Literals(['Connecting', 'Online', 'Reconnecting', 'Lost'])
type Link = typeof Link.Type

export const Share = Schema.Literals(['Idle', 'Shared', 'Copied'])
export type Share = typeof Share.Type

export const CodeCopy = Schema.Literals(['Copied', 'Failed'])
export type CodeCopy = typeof CodeCopy.Type

const Departure = Schema.Literals(['Staying', 'Leaving'])
type Departure = typeof Departure.Type

export const Presses = Schema.Struct({
  queued: Schema.Array(Schema.Finite),
  held: Schema.Finite,
  presses: Schema.Finite,
  heldFrom: Schema.Finite,
})
export type Presses = typeof Presses.Type

export const noPresses: Presses = {
  queued: [],
  held: 0,
  presses: 0,
  heldFrom: -1,
}

export const NudgeReason = Schema.Literals(['HostPicks', 'Locked'])
export type NudgeReason = typeof NudgeReason.Type

const Nudge = Schema.Struct({
  reason: NudgeReason,
  count: Schema.Finite,
})
type Nudge = typeof Nudge.Type

export const Room = Schema.Struct({
  code: RoomCode,
  slot: Schema.Finite,
  maybePlayerId: Schema.Option(Schema.String),
  maybeLobby: Schema.Option(Lobby),
  link: Link,
  droppedAtMs: Schema.Option(Schema.Finite),
  session: RoomSession,
  maybeWorld: Schema.Option(WorldState),
  frameEvents: Schema.Array(GameEvent),
  eventsTick: Schema.Finite,
  predictedShots: Schema.Finite,
  tracers: Schema.Array(Bullet),
  tracerCount: Schema.Finite,
  hits: Schema.Struct({ looked: Schema.Finite, confirmed: Schema.Finite }),
  presses: Presses,
  share: Share,
  codeCopies: Schema.Finite,
  departure: Departure,
  maybeNameDraft: Schema.Option(Schema.String),
  maybeNudge: Schema.Option(Nudge),
})
export type Room = typeof Room.Type

export const Screen = State({
  Closed: {},
  Hub: { maybeProblem: Schema.Option(CoopProblem) },
  Code: { typed: Schema.String, maybeProblem: Schema.Option(CoopProblem) },
  Asking: { request: RoomRequest },
  Queue: { queue: Queue },
  InRoom: { room: Room },
})
export type Screen = typeof Screen.Type

export const isInLobby = (room: Room): boolean =>
  Option.match(room.maybeLobby, {
    onNone: () => true,
    onSome: lobby => lobby.status === 'Lobby',
  })

export const maybeRoomOf = (
  model: Readonly<{ screen: Screen }>,
): Option.Option<Room> =>
  Screen.$is('InRoom')(model.screen)
    ? Option.some(model.screen.room)
    : Option.none()
