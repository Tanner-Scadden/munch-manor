import { Array, Option, Order, Schema, pipe } from 'effect'

import {
  CallingInput,
  LookInput,
  MAX_PLAYERS,
  NameInput,
  RankInput,
  cleanName,
} from './Lobby'

// NOTE: QUICK PLAY (MULTIPLAYER.md, decision 15), as pure functions over
// plain data, apart from the Matchmaker Durable Object that runs them
// (infra/worker/matchmaker.ts). A player who presses QUICK PLAY:
//
// 1. goes into an open public lobby with a free seat, the fullest first, or
// 2. waits in a first-come queue. When QUICK_PLAY_GROUP_SIZE players are
//    waiting, they get a new public lobby together.
// 3. After OFFER_AFTER_MS in the queue, if 2 or 3 are waiting, each is
//    offered "Start with N players?". If every one of them accepts, they get
//    a public lobby together, which still takes Quick Play players into its
//    free seats until everyone presses READY. Anyone who keeps waiting stays
//    queued, and so does everyone else, until the next offer. A lone player
//    is never offered it, and a 4th player arriving during an offer makes a
//    group of 4 instead.
//
// Every function returns the next matchmaker and what the Durable Object
// must do: send a message, seat a player in a room, make a room, or wake
// later.

export const QUICK_PLAY_GROUP_SIZE = MAX_PLAYERS
export const OFFER_AFTER_MS = 45 * 1000
export const MIN_OFFER_GROUP = 2
export const OFFER_ANSWER_MS = 20 * 1000
export const ROOM_LISTING_MS = 10 * 60 * 1000
// NOTE: a group of four forms first from players on one continent; a
// player who has waited this long joins anyone's group.
export const REGION_WIDEN_MS = 15 * 1000

// MESSAGES

// NOTE: the Quick Play socket speaks JSON: it is a few messages a minute.
export const QuickClient = Schema.TaggedUnion({
  Hello: {
    token: Schema.String.check(Schema.isMaxLength(1024)),
    name: NameInput,
    look: Schema.optionalKey(LookInput),
    rank: Schema.optionalKey(RankInput),
    calling: Schema.optionalKey(CallingInput),
  },
  Answer: { accept: Schema.Boolean },
  Cancel: {},
})
export type QuickClient = typeof QuickClient.Type
export type QuickHello = typeof QuickClient.cases.Hello.Type

// NOTE: `offerPlayers` is 0 with no offer open, else the size of the group
// offered to start now; `accepted` is how many of it said yes so far.
export const QuickServer = Schema.TaggedUnion({
  Waiting: {
    names: Schema.Array(Schema.String),
    waiting: Schema.Number,
    groupSize: Schema.Number,
    position: Schema.Number,
    offerPlayers: Schema.Number,
    accepted: Schema.Number,
  },
  Matched: { code: Schema.String, slot: Schema.Number },
  Refused: { reason: Schema.String },
})
export type QuickServer = typeof QuickServer.Type

export const QuickClientJson = Schema.fromJsonString(QuickClient)
export const QuickServerJson = Schema.fromJsonString(QuickServer)

// STATE

// NOTE: `name` is as the player sent it; the room cleans it when it seats
// them, and the queue screen shows it cleaned.
export interface Queued {
  readonly socket: string
  readonly playerId: string
  readonly name: string
  readonly look?: string
  readonly rank?: number
  readonly calling?: string
  // NOTE: the continent the player connected from, as Cloudflare names it
  // (NA, EU, AS, ...); '' when unknown.
  readonly region?: string
  readonly queuedMs: number
}

export interface Offer {
  readonly sockets: ReadonlyArray<string>
  readonly accepted: ReadonlyArray<string>
  readonly madeMs: number
}

// NOTE: a public lobby with `members` seated, as the room last said.
export interface OpenRoom {
  readonly code: string
  readonly members: number
  readonly updatedMs: number
}

export interface Matchmaker {
  readonly queue: ReadonlyArray<Queued>
  readonly offer: Option.Option<Offer>
  readonly rooms: ReadonlyArray<OpenRoom>
  // NOTE: no offer is made again before this, after one ended unanswered.
  readonly quietUntilMs: number
}

// NOTE: how the Matchmaker Durable Object keeps the state between wakes.
const QueuedSchema = Schema.Struct({
  socket: Schema.String,
  playerId: Schema.String,
  name: Schema.String,
  look: Schema.optionalKey(Schema.String),
  rank: Schema.optionalKey(Schema.Number),
  calling: Schema.optionalKey(Schema.String),
  region: Schema.optionalKey(Schema.String),
  queuedMs: Schema.Number,
})

export const MatchmakerJson = Schema.fromJsonString(
  Schema.Struct({
    queue: Schema.Array(QueuedSchema),
    offer: Schema.OptionFromNullOr(
      Schema.Struct({
        sockets: Schema.Array(Schema.String),
        accepted: Schema.Array(Schema.String),
        madeMs: Schema.Number,
      }),
    ),
    rooms: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        members: Schema.Number,
        updatedMs: Schema.Number,
      }),
    ),
    quietUntilMs: Schema.Number,
  }),
)

export const RoomListing = Schema.Struct({
  code: Schema.String,
  members: Schema.Number,
  open: Schema.Boolean,
})
export type RoomListing = typeof RoomListing.Type

export const emptyMatchmaker: Matchmaker = {
  queue: [],
  offer: Option.none(),
  rooms: [],
  quietUntilMs: 0,
}

export type Action =
  | {
      readonly _tag: 'Send'
      readonly socket: string
      readonly message: QuickServer
    }
  | {
      readonly _tag: 'Seat'
      readonly player: Queued
      readonly code: string
    }
  | { readonly _tag: 'MakeRoom'; readonly players: ReadonlyArray<Queued> }
  | { readonly _tag: 'WakeAt'; readonly atMs: number }

export interface Stepped {
  readonly matchmaker: Matchmaker
  readonly actions: ReadonlyArray<Action>
}

const send = (socket: string, message: QuickServer): Action => ({
  _tag: 'Send',
  socket,
  message,
})

// RULES

const isFresh = (room: OpenRoom, nowMs: number): boolean =>
  nowMs - room.updatedMs < ROOM_LISTING_MS

const fullestFirst = Order.mapInput(
  Order.flip(Order.Number),
  (room: OpenRoom) => room.members,
)

const roomWithSeat = (
  rooms: ReadonlyArray<OpenRoom>,
  nowMs: number,
): Option.Option<OpenRoom> =>
  pipe(
    rooms,
    Array.filter(room => room.members < MAX_PLAYERS && isFresh(room, nowMs)),
    Array.sort(fullestFirst),
    Array.head,
  )

// NOTE: the first queued players go to rooms with seats, FIFO.
const seatInRooms = (matchmaker: Matchmaker, nowMs: number): Stepped =>
  Option.match(
    Option.all([
      Array.head(matchmaker.queue),
      roomWithSeat(matchmaker.rooms, nowMs),
    ]),
    {
      onNone: () => ({ matchmaker, actions: [] }),
      onSome: ([player, room]) => {
        const next = seatInRooms(
          {
            ...matchmaker,
            queue: Array.drop(matchmaker.queue, 1),
            rooms: Array.map(matchmaker.rooms, listed =>
              listed.code === room.code
                ? { ...listed, members: listed.members + 1 }
                : listed,
            ),
          },
          nowMs,
        )
        return {
          matchmaker: next.matchmaker,
          actions: [{ _tag: 'Seat', player, code: room.code }, ...next.actions],
        }
      },
    },
  )

const isWidened = (player: Queued, nowMs: number): boolean =>
  nowMs - player.queuedMs >= REGION_WIDEN_MS

const fitsWith =
  (anchor: Queued, nowMs: number) =>
  (player: Queued): boolean =>
    (player.region ?? '') === (anchor.region ?? '') ||
    isWidened(anchor, nowMs) ||
    isWidened(player, nowMs)

// NOTE: the first group of four, the oldest player first: their own
// continent's players, or anyone once either has waited REGION_WIDEN_MS.
const groupOf = (
  queue: ReadonlyArray<Queued>,
  nowMs: number,
): Option.Option<ReadonlyArray<Queued>> =>
  Array.findFirst(
    Array.map(queue, anchor =>
      Array.take(
        Array.filter(queue, fitsWith(anchor, nowMs)),
        QUICK_PLAY_GROUP_SIZE,
      ),
    ),
    group => group.length >= QUICK_PLAY_GROUP_SIZE,
  )

const formGroups = (matchmaker: Matchmaker, nowMs: number): Stepped =>
  Option.match(groupOf(matchmaker.queue, nowMs), {
    onNone: () => ({ matchmaker, actions: [] }),
    onSome: players => {
      const next = formGroups(
        {
          ...matchmaker,
          queue: Array.filter(
            matchmaker.queue,
            queued =>
              !Array.some(players, taken => taken.socket === queued.socket),
          ),
        },
        nowMs,
      )
      return {
        matchmaker: next.matchmaker,
        actions: [{ _tag: 'MakeRoom', players }, ...next.actions],
      }
    },
  })

// NOTE: four or more waiting but split by continent: wake when the oldest
// of them may join anyone.
const widenDueMs = (matchmaker: Matchmaker, nowMs: number) =>
  matchmaker.queue.length >= QUICK_PLAY_GROUP_SIZE
    ? Option.map(
        Array.head(
          Array.filter(matchmaker.queue, player => !isWidened(player, nowMs)),
        ),
        oldest => oldest.queuedMs + REGION_WIDEN_MS,
      )
    : Option.none()

const queuedSockets = (matchmaker: Matchmaker) =>
  Array.map(matchmaker.queue, player => player.socket)

// NOTE: an offer stands only while everyone it was made to still waits.
const keepOffer = (matchmaker: Matchmaker, nowMs: number): Matchmaker =>
  Option.match(matchmaker.offer, {
    onNone: () => matchmaker,
    onSome: offer =>
      Array.every(offer.sockets, socket =>
        Array.contains(queuedSockets(matchmaker), socket),
      )
        ? matchmaker
        : { ...matchmaker, offer: Option.none(), quietUntilMs: nowMs },
  })

const offerDueMs = (matchmaker: Matchmaker): Option.Option<number> =>
  Option.map(Array.head(matchmaker.queue), oldest =>
    Math.max(oldest.queuedMs + OFFER_AFTER_MS, matchmaker.quietUntilMs),
  )

const canOffer = (count: number): boolean =>
  count >= MIN_OFFER_GROUP && count < QUICK_PLAY_GROUP_SIZE

const makeOffer = (matchmaker: Matchmaker, nowMs: number): Matchmaker =>
  Option.isNone(matchmaker.offer) &&
  canOffer(matchmaker.queue.length) &&
  Option.exists(offerDueMs(matchmaker), dueMs => dueMs <= nowMs)
    ? {
        ...matchmaker,
        offer: Option.some({
          sockets: queuedSockets(matchmaker),
          accepted: [],
          madeMs: nowMs,
        }),
      }
    : matchmaker

// NOTE: an offer nobody finished answering lapses, as if declined.
const lapseOffer = (matchmaker: Matchmaker, nowMs: number): Matchmaker =>
  Option.exists(
    matchmaker.offer,
    offer => nowMs - offer.madeMs >= OFFER_ANSWER_MS,
  )
    ? endOffer(matchmaker, nowMs)
    : matchmaker

const endOffer = (matchmaker: Matchmaker, nowMs: number): Matchmaker => ({
  ...matchmaker,
  offer: Option.none(),
  quietUntilMs: nowMs + OFFER_AFTER_MS,
})

const acceptedAll = (
  matchmaker: Matchmaker,
): Option.Option<ReadonlyArray<Queued>> =>
  Option.flatMap(matchmaker.offer, offer =>
    Array.every(offer.sockets, socket => Array.contains(offer.accepted, socket))
      ? Option.some(
          Array.filter(matchmaker.queue, player =>
            Array.contains(offer.sockets, player.socket),
          ),
        )
      : Option.none(),
  )

const startAccepted = (matchmaker: Matchmaker): Stepped =>
  Option.match(acceptedAll(matchmaker), {
    onNone: () => ({ matchmaker, actions: [] }),
    onSome: players => ({
      matchmaker: {
        ...matchmaker,
        offer: Option.none(),
        queue: Array.filter(
          matchmaker.queue,
          player =>
            !Array.some(players, taken => taken.socket === player.socket),
        ),
      },
      actions: [{ _tag: 'MakeRoom', players }],
    }),
  })

const statusOf = (matchmaker: Matchmaker): ReadonlyArray<Action> =>
  Array.map(matchmaker.queue, (player, index) => {
    const offer = Option.filter(matchmaker.offer, held =>
      Array.contains(held.sockets, player.socket),
    )
    return send(
      player.socket,
      QuickServer.cases.Waiting.make({
        names: Array.map(matchmaker.queue, queued => cleanName(queued.name)),
        waiting: matchmaker.queue.length,
        groupSize: QUICK_PLAY_GROUP_SIZE,
        position: index + 1,
        offerPlayers: Option.match(offer, {
          onNone: () => 0,
          onSome: held => held.sockets.length,
        }),
        accepted: Option.match(offer, {
          onNone: () => 0,
          onSome: held => held.accepted.length,
        }),
      }),
    )
  })

const wakeOf = (matchmaker: Matchmaker, nowMs: number): ReadonlyArray<Action> =>
  Option.match(widenDueMs(matchmaker, nowMs), {
    onSome: (atMs): ReadonlyArray<Action> => [{ _tag: 'WakeAt', atMs }],
    onNone: () => offerWakeOf(matchmaker),
  })

const offerWakeOf = (matchmaker: Matchmaker): ReadonlyArray<Action> =>
  Option.match(matchmaker.offer, {
    onSome: offer => [{ _tag: 'WakeAt', atMs: offer.madeMs + OFFER_ANSWER_MS }],
    onNone: () =>
      canOffer(matchmaker.queue.length)
        ? Option.match(offerDueMs(matchmaker), {
            onNone: () => [],
            onSome: atMs => [{ _tag: 'WakeAt', atMs }],
          })
        : [],
  })

// NOTE: after anything happens: seat who fits in open rooms, group four,
// settle the offer, then tell everyone still waiting where they stand.
const settle = (matchmaker: Matchmaker, nowMs: number): Stepped => {
  const seated = seatInRooms(
    {
      ...matchmaker,
      rooms: Array.filter(matchmaker.rooms, room => isFresh(room, nowMs)),
    },
    nowMs,
  )
  const grouped = formGroups(seated.matchmaker, nowMs)
  const started = startAccepted(
    lapseOffer(keepOffer(grouped.matchmaker, nowMs), nowMs),
  )
  const offered = makeOffer(started.matchmaker, nowMs)
  return {
    matchmaker: offered,
    actions: [
      ...seated.actions,
      ...grouped.actions,
      ...started.actions,
      ...statusOf(offered),
      ...wakeOf(offered, nowMs),
    ],
  }
}

// EVENTS

export const arrive = (
  matchmaker: Matchmaker,
  player: Queued,
  nowMs: number,
): Stepped =>
  settle(
    {
      ...matchmaker,
      queue: Array.append(
        Array.filter(
          matchmaker.queue,
          queued => queued.socket !== player.socket,
        ),
        player,
      ),
    },
    nowMs,
  )

// NOTE: a player who cancelled or whose socket closed.
export const leave = (
  matchmaker: Matchmaker,
  socket: string,
  nowMs: number,
): Stepped =>
  settle(
    {
      ...matchmaker,
      queue: Array.filter(matchmaker.queue, queued => queued.socket !== socket),
    },
    nowMs,
  )

export const answer = (
  matchmaker: Matchmaker,
  socket: string,
  accept: boolean,
  nowMs: number,
): Stepped =>
  Option.match(
    Option.filter(matchmaker.offer, offer =>
      Array.contains(offer.sockets, socket),
    ),
    {
      onNone: () => settle(matchmaker, nowMs),
      onSome: offer =>
        settle(
          accept
            ? {
                ...matchmaker,
                offer: Option.some({
                  ...offer,
                  accepted: Array.dedupe(Array.append(offer.accepted, socket)),
                }),
              }
            : endOffer(matchmaker, nowMs),
          nowMs,
        ),
    },
  )

// NOTE: a public room says how many it seats and whether it still takes
// players (in its lobby, before everyone pressed READY).
export const listed = (
  matchmaker: Matchmaker,
  room: RoomListing,
  nowMs: number,
): Stepped =>
  settle(
    {
      ...matchmaker,
      rooms: room.open
        ? Array.append(
            Array.filter(
              matchmaker.rooms,
              listedRoom => listedRoom.code !== room.code,
            ),
            { code: room.code, members: room.members, updatedMs: nowMs },
          )
        : Array.filter(
            matchmaker.rooms,
            listedRoom => listedRoom.code !== room.code,
          ),
    },
    nowMs,
  )

// NOTE: a seat or a room that did not work out: the room is forgotten
// until it lists itself again, and the player goes back to the front.
export const seatFailed = (
  matchmaker: Matchmaker,
  player: Queued,
  code: string,
  nowMs: number,
): Stepped =>
  settle(
    {
      ...matchmaker,
      rooms: Array.filter(matchmaker.rooms, room => room.code !== code),
      queue: Array.prepend(
        Array.filter(
          matchmaker.queue,
          queued => queued.socket !== player.socket,
        ),
        player,
      ),
    },
    nowMs,
  )

export const roomMade = (
  matchmaker: Matchmaker,
  code: string,
  members: number,
  nowMs: number,
): Stepped => listed(matchmaker, { code, members, open: true }, nowMs)

export const wake = (matchmaker: Matchmaker, nowMs: number): Stepped =>
  settle(matchmaker, nowMs)
