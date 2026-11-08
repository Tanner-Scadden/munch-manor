import { Option, Schema, SchemaTransformation } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import {
  Lobby,
  PickedMode,
  RoomCode,
  RoomDifficulty,
  Session,
  type World,
} from '@munch/netcode'

import { Calling } from '../shared/playerData'
import {
  type OwnSeat,
  ROOM_WORLD,
  type RoomWorld,
} from '../world/net/roomWorld'
import { Bullet, GameEvent } from '../world/schema/worldSchema'

// The co-op room as the client holds it: the seam to the World it plays,
// the room's record and the screens co-op's Block (src/features/coop/)
// shows, and the reads of it the root's drawing, the end card, and the
// online run share. Nothing is saved: a room lasts as long as the page, and
// a reload rejoins it from the `?room=CODE` link (see MULTIPLAYER.md, "What
// Phases 2 and 3 built").

// THE SEAM
//
// NOTE: the one place co-op names the world it plays: the game's own World
// in a room (src/world/net/roomWorld.ts), the same one the GameRoom runs. The client
// never starts or steps it; it reads the room's snapshots and diffs back,
// interpolates them, and predicts its own player with it. Nothing else in
// src/features/coop reads the world's insides; the root draws it with the game's
// own scene (src/app/update/coopPlay.ts).

export type WorldState = RoomWorld
export type OwnPlayer = OwnSeat

export const coopWorld: World<WorldState, OwnPlayer> = ROOM_WORLD

// SCHEMAS

// NOTE: the Session and the world are plain data from packages/netcode and
// src/world/net/roomWorld.ts, held in the Model as opaque values. Only Session's pure
// functions and the seam above read them.
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

// NOTE: a Session is a live connection's state, so it is never written
// out: a Model kept across a dev reload holds a fresh one, and the room
// sends a snapshot on the reconnect.
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

// PROBLEMS

// NOTE: what can go wrong, each shown as an icon and a word or two.
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

// LOBBY CHANGES

// NOTE: what a player writes to the room's lobby scope. The service fills
// in who it is for (`by`), so the update never needs the player id.
export const LobbyChange = defineTaggedUnion({
  ChangedReady: { ready: Schema.Boolean, pingMs: Schema.Finite },
  ChangedPicks: { mode: PickedMode, difficulty: RoomDifficulty },
  ChangedModifiers: { modifiers: Schema.Finite },
  ChangedMemberCalling: { calling: Calling },
  ChangedMemberName: { name: Schema.String },
  KickedPlayer: { playerId: Schema.String },
})
export type LobbyChange = typeof LobbyChange.Type

// REQUESTS

export const RoomRequest = defineTaggedUnion({
  Create: {},
  Join: { code: RoomCode },
})
export type RoomRequest = typeof RoomRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Finite })
export type RoomTicket = typeof RoomTicket.Type

// QUEUE

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

// ROOM

// NOTE: `Lost` is a link that stayed down past LOST_AFTER_MS (src/features/coop/update.ts):
// the arena says so and offers the way out, and the tries go on.
const Link = Schema.Literals(['Connecting', 'Online', 'Reconnecting', 'Lost'])
type Link = typeof Link.Type

export const Share = Schema.Literals(['Idle', 'Shared', 'Copied'])
export type Share = typeof Share.Type

export const CodeCopy = Schema.Literals(['Copied', 'Failed'])
export type CodeCopy = typeof CodeCopy.Type

const Departure = Schema.Literals(['Staying', 'Leaving'])
type Departure = typeof Departure.Type

// NOTE: the player's presses on their way to the room (src/world/net/roomWorld.ts,
// "ACTIONS"): `queued` are action codes not sent yet, `held` is the value
// the inputs carry now, `presses` counts them, and `heldFrom` is the input
// tick it started on, so each press rides at least one tick before the
// next one replaces it.
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

// NOTE: a tap on a pick the player cannot change answers with a note, in
// place: the host picks, or Nightmare is locked. `count` restarts the note's
// fade on every tap.
export const NudgeReason = Schema.Literals(['HostPicks', 'Locked'])
export type NudgeReason = typeof NudgeReason.Type

const Nudge = Schema.Struct({
  reason: NudgeReason,
  count: Schema.Finite,
})
type Nudge = typeof Nudge.Type

// NOTE: `codeCopies` counts the times the room code went to the clipboard,
// so each copy flashes COPIED! afresh.
// NOTE: `maybeWorld` is the World to draw this frame, everyone else about
// 100 ms behind and your own player predicted; `frameEvents` are the
// events the drawing reached this frame, each once, and `eventsTick` the
// room tick they reached. `predictedShots` counts the shots your own
// player fired in this frame's newly predicted ticks, so the shot sounds
// at once; a correction from the room replays ticks already counted.
// `tracers` are those shots' bullets, drawn at once and hurting nothing
// (src/world/step/simulation.ts, aimTracers), and `tracerCount` numbers them. `hits`
// counts the tracers that stopped on a zombie (looked) beside your hits
// the room confirmed, for the audit's hit registration.
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

// SCREENS

export const Screen = defineTaggedUnion({
  Closed: {},
  Hub: { maybeProblem: Schema.Option(CoopProblem) },
  Code: { typed: Schema.String, maybeProblem: Schema.Option(CoopProblem) },
  Asking: { request: RoomRequest },
  Queue: { queue: Queue },
  InRoom: { room: Room },
})
export type Screen = typeof Screen.Type

// NOTE: `Screen.InRoom({ room })` without its Schema validation, which walks
// the whole room. The room's frame moves the room on every tick.
export const screenInRoom = (room: Room): Screen => ({ _tag: 'InRoom', room })

// READS

export const isInLobby = (room: Room): boolean =>
  Option.match(room.maybeLobby, {
    onNone: () => true,
    onSome: lobby => lobby.status === 'Lobby',
  })

// NOTE: the room co-op's screen holds, if it is in one.
export const maybeRoomOf = (
  model: Readonly<{ screen: Screen }>,
): Option.Option<Room> =>
  Screen.match(model.screen, {
    Closed: () => Option.none(),
    Hub: () => Option.none(),
    Code: () => Option.none(),
    Asking: () => Option.none(),
    Queue: () => Option.none(),
    InRoom: ({ room }) => Option.some(room),
  })
