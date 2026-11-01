import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { Lobby, PickedMode, RoomCode, RoomDifficulty } from '@munch/netcode'

import { Bullet, GameEvent } from '../worldSchema'
import { RoomSession, WorldState } from './seam'

// NOTE: co-op's own state, a Block the root Model holds. Nothing here is
// saved: a room lasts as long as the page, and a reload rejoins it from the
// `?room=CODE` link (see MULTIPLAYER.md, "What Phases 2 and 3 built").

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
  ChangedReady: { ready: Schema.Boolean, pingMs: Schema.Number },
  ChangedPicks: { mode: PickedMode, difficulty: RoomDifficulty },
  KickedPlayer: { playerId: Schema.String },
})
export type LobbyChange = typeof LobbyChange.Type

// REQUESTS

export const RoomRequest = defineTaggedUnion({
  Create: {},
  Join: { code: RoomCode },
})
export type RoomRequest = typeof RoomRequest.Type

export const RoomTicket = Schema.Struct({ code: RoomCode, slot: Schema.Number })
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
  waiting: Schema.Number,
  position: Schema.Number,
  groupSize: Schema.Number,
  offerPlayers: Schema.Number,
  accepted: Schema.Number,
  answer: OfferAnswer,
})
export type Queue = typeof Queue.Type

// ROOM

const Link = Schema.Literals(['Connecting', 'Online', 'Reconnecting'])
type Link = typeof Link.Type

export const Share = Schema.Literals(['Idle', 'Shared', 'Copied'])
export type Share = typeof Share.Type

export const CodeCopy = Schema.Literals(['Copied', 'Failed'])
export type CodeCopy = typeof CodeCopy.Type

const Departure = Schema.Literals(['Staying', 'Leaving'])
type Departure = typeof Departure.Type

// NOTE: the player's presses on their way to the room (src/roomWorld.ts,
// "ACTIONS"): `queued` are action codes not sent yet, `held` is the value
// the inputs carry now, `presses` counts them, and `heldFrom` is the input
// tick it started on, so each press rides at least one tick before the
// next one replaces it.
export const Presses = Schema.Struct({
  queued: Schema.Array(Schema.Number),
  held: Schema.Number,
  presses: Schema.Number,
  heldFrom: Schema.Number,
})
export type Presses = typeof Presses.Type

export const noPresses: Presses = {
  queued: [],
  held: 0,
  presses: 0,
  heldFrom: -1,
}

// NOTE: `codeCopies` counts the times the room code went to the clipboard,
// so each copy flashes COPIED! afresh.
// NOTE: `maybeWorld` is the World to draw this frame, everyone else about
// 100 ms behind and your own player predicted; `frameEvents` are the
// events the drawing reached this frame, each once, and `eventsTick` the
// room tick they reached. `predictedShots` counts the shots your own
// player fired in this frame's newly predicted ticks, so the shot sounds
// at once; a correction from the room replays ticks already counted.
// `tracers` are those shots' bullets, drawn at once and hurting nothing
// (src/simulation.ts, aimTracers), and `tracerCount` numbers them. `hits`
// counts the tracers that stopped on a zombie (looked) beside your hits
// the room confirmed, for the audit's hit registration.
export const Room = Schema.Struct({
  code: RoomCode,
  slot: Schema.Number,
  maybePlayerId: Schema.Option(Schema.String),
  maybeLobby: Schema.Option(Lobby),
  link: Link,
  session: RoomSession,
  maybeWorld: Schema.Option(WorldState),
  frameEvents: Schema.Array(GameEvent),
  eventsTick: Schema.Number,
  predictedShots: Schema.Number,
  tracers: Schema.Array(Bullet),
  tracerCount: Schema.Number,
  hits: Schema.Struct({ looked: Schema.Number, confirmed: Schema.Number }),
  presses: Presses,
  share: Share,
  codeCopies: Schema.Number,
  departure: Departure,
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

// NOTE: `name`, `look`, and `rank` are what joining sends for this player
// (the look as src/playerData.ts writes it, the rank as src/rank.ts works
// it out from their points).
export const Model = Schema.Struct({
  screen: Screen,
  name: Schema.String,
  look: Schema.String,
  rank: Schema.Number,
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  screen: Screen.Closed(),
  name: '',
  look: '',
  rank: 1,
}

export const emptyQueue: Queue = {
  names: [],
  waiting: 0,
  position: 0,
  groupSize: 4,
  offerPlayers: 0,
  accepted: 0,
  answer: 'Unanswered',
}
