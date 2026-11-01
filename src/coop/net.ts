import {
  Array,
  Context,
  Effect,
  Layer,
  Option,
  Ref,
  Stream,
  pipe,
} from 'effect'

import {
  ChangedMemberCalling,
  ChangedPicks,
  ChangedReady,
  type ClientFrame,
  KickedPlayer,
  LeftRoom,
  RoomRefusal,
} from '@munch/netcode'
import {
  LobbyEvent,
  type QuickPlay,
  QuickPlayEvent,
  type RoomClient,
  RoomEvent,
  connectRoom,
  createRoom,
  followLobby,
  joinRoom,
  roomSocketUrl,
  startQuickPlay,
} from '@munch/netcode/browser'
import type { Mutation } from '@munch/sync-engine'

import { API_ORIGIN } from '../apiOrigin'
import type { Calling } from '../playerData'
import { PlayerStore } from '../store'
import {
  type CoopProblem,
  LobbyChange,
  RoomRequest,
  type RoomTicket,
} from './model'
import type { RoomAccess } from './roomReplica'

// SERVICE

// NOTE: everything co-op does on the network, as one Effect service: the
// room requests, the QUICK PLAY queue, the lobby, and the game socket. The
// streams are what the Subscriptions run, and each keeps its live handle
// here while it runs, so a Command can answer an offer, write to the
// lobby, or send inputs on the socket the Subscription opened. Tests swap
// in a fake (src/coop/testing.ts).
export class CoopNet extends Context.Service<
  CoopNet,
  {
    readonly requestRoom: (
      request: RoomRequest,
      name: string,
      look: string,
      rank: number,
      calling: Calling,
    ) => Effect.Effect<RoomTicket, CoopProblem>
    readonly quickPlay: (
      name: string,
      look: string,
      rank: number,
      calling: Calling,
    ) => Stream.Stream<QuickPlayEvent>
    readonly answerOffer: (accept: boolean) => Effect.Effect<void>
    readonly cancelQuickPlay: Effect.Effect<void>
    readonly lobby: (code: string) => Stream.Stream<LobbyEvent>
    readonly changeLobby: (
      change: LobbyChange,
    ) => Effect.Effect<void, CoopProblem>
    readonly room: (code: string) => Stream.Stream<RoomEvent>
    readonly sendToRoom: (
      frames: ReadonlyArray<ClientFrame>,
    ) => Effect.Effect<ReadonlyArray<number>>
    readonly leaveRoom: Effect.Effect<void>
    // NOTE: a new socket for the run, whose link brings a fresh Snapshot.
    readonly resyncRoom: Effect.Effect<void>
  }
>()('munch-manor/coop/net/CoopNet') {}

// LIVE

const problemOfRefusal = (refusal: RoomRefusal): CoopProblem =>
  RoomRefusal.match(refusal, {
    NoRoom: () => 'NoRoom',
    Full: () => 'Full',
    Started: () => 'Started',
    RateLimited: () => 'Busy',
    Unauthorized: () => 'Offline',
    BadRequest: () => 'Offline',
    Unavailable: () => 'Offline',
  })

type LobbyWrite = (
  change: LobbyChange | 'Left',
) => Effect.Effect<void, CoopProblem>

type Handles = Readonly<{
  quick: Ref.Ref<Option.Option<QuickPlay>>
  room: Ref.Ref<Option.Option<RoomClient>>
  lobbyWrite: Ref.Ref<Option.Option<LobbyWrite>>
}>

type LobbyWriter<E> = <A, I>(
  mutation: Mutation<string, A, I>,
  args: NoInfer<A>,
) => Effect.Effect<string, E>

const writeChange = <E>(
  write: LobbyWriter<E>,
  by: string,
  change: LobbyChange | 'Left',
): Effect.Effect<void, CoopProblem> =>
  pipe(
    change === 'Left'
      ? write(LeftRoom, { by })
      : LobbyChange.match(change, {
          ChangedReady: ({ ready, pingMs }) =>
            write(ChangedReady, {
              by,
              ready,
              pingMs: Math.max(0, Math.min(60_000, Math.round(pingMs))),
            }),
          ChangedMemberCalling: ({ calling }) =>
            write(ChangedMemberCalling, { by, calling }),
          ChangedPicks: ({ mode, difficulty }) =>
            write(ChangedPicks, { by, mode, difficulty }),
          KickedPlayer: ({ playerId }) => write(KickedPlayer, { by, playerId }),
        }),
    Effect.asVoid,
    Effect.mapError((): CoopProblem => 'Offline'),
  )

const offline = <A>(): Effect.Effect<A, CoopProblem> =>
  Effect.fail<CoopProblem>('Offline')

// NOTE: the lobby follows the room's scope with the player database's own
// Replica in the leader tab. A follower tab, which runs no sync, follows it
// over a socket of its own, as the dev page does.
const lobbyStream = (
  access: RoomAccess,
  code: string,
  handles: Handles,
): Stream.Stream<LobbyEvent> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const playerId = yield* access.playerId
      const isLeader = yield* access.canFollow
      if (isLeader) {
        yield* Ref.set(
          handles.lobbyWrite,
          Option.some((change: LobbyChange | 'Left') =>
            writeChange(access.writeRoom, playerId, change),
          ),
        )
        return pipe(
          access.followRoom(code),
          Stream.map(lobby => LobbyEvent.cases.Updated.make({ lobby })),
          Stream.catch(error =>
            Stream.make(
              LobbyEvent.cases.Stopped.make({ reason: error.reason }),
            ),
          ),
        )
      }
      return Stream.unwrap(
        Effect.gen(function* () {
          const client = yield* followLobby({
            origin: API_ORIGIN,
            code,
            clientId: `tab-${playerId.slice(0, 8)}`,
            token: access.token,
          })
          yield* Ref.set(
            handles.lobbyWrite,
            Option.some((change: LobbyChange | 'Left') =>
              writeChange(client.write, playerId, change),
            ),
          )
          return client.events
        }),
      )
    }).pipe(
      Effect.catch(error =>
        Effect.succeed(
          Stream.make(LobbyEvent.cases.Stopped.make({ reason: error.reason })),
        ),
      ),
    ),
  ).pipe(Stream.ensuring(Ref.set(handles.lobbyWrite, Option.none())))

const writeLobby = (
  handles: Handles,
  change: LobbyChange | 'Left',
): Effect.Effect<void, CoopProblem> =>
  Effect.flatMap(Ref.get(handles.lobbyWrite), maybeWrite =>
    Option.match(maybeWrite, {
      onNone: () => offline<void>(),
      onSome: write => write(change),
    }),
  )

const LEAVE_SETTLE = '400 millis'

const liveOf = (maybeAccess: Option.Option<RoomAccess>) =>
  Effect.gen(function* () {
    const handles: Handles = {
      quick: yield* Ref.make(Option.none<QuickPlay>()),
      room: yield* Ref.make(Option.none<RoomClient>()),
      lobbyWrite: yield* Ref.make(Option.none<LobbyWrite>()),
    }

    const withAccess = <A>(
      use: (access: RoomAccess) => Effect.Effect<A, CoopProblem>,
    ): Effect.Effect<A, CoopProblem> =>
      Option.match(maybeAccess, { onNone: offline<A>, onSome: use })

    const streamWithAccess = <A>(
      use: (access: RoomAccess) => Stream.Stream<A>,
      whenOffline: Stream.Stream<A>,
    ): Stream.Stream<A> =>
      Option.match(maybeAccess, { onNone: () => whenOffline, onSome: use })

    const tokenOf = (access: RoomAccess) =>
      Effect.mapError(access.token, (): CoopProblem => 'Offline')

    return CoopNet.of({
      requestRoom: (request, name, look, rank, calling) =>
        withAccess(access =>
          Effect.flatMap(tokenOf(access), token =>
            pipe(
              RoomRequest.match(request, {
                Create: () =>
                  createRoom(API_ORIGIN, token, name, look, rank, calling),
                Join: ({ code }) =>
                  joinRoom(API_ORIGIN, token, code, name, look, rank, calling),
              }),
              Effect.mapError(error => problemOfRefusal(error.refusal)),
            ),
          ),
        ),

      quickPlay: (name, look, rank, calling) =>
        streamWithAccess(
          access =>
            Stream.unwrap(
              Effect.gen(function* () {
                const quick = yield* startQuickPlay({
                  origin: API_ORIGIN,
                  name,
                  look,
                  rank,
                  calling,
                  token: access.token,
                })
                yield* Ref.set(handles.quick, Option.some(quick))
                return quick.events
              }),
            ).pipe(Stream.ensuring(Ref.set(handles.quick, Option.none()))),
          Stream.make(QuickPlayEvent.cases.Dropped.make({ reason: 'Offline' })),
        ),

      answerOffer: accept =>
        Effect.flatMap(Ref.get(handles.quick), maybeQuick =>
          Option.match(maybeQuick, {
            onNone: () => Effect.void,
            onSome: quick => quick.answer(accept),
          }),
        ),

      cancelQuickPlay: Effect.flatMap(Ref.get(handles.quick), maybeQuick =>
        Option.match(maybeQuick, {
          onNone: () => Effect.void,
          onSome: quick => quick.cancel,
        }),
      ),

      lobby: code =>
        streamWithAccess(
          access => lobbyStream(access, code, handles),
          Stream.make(LobbyEvent.cases.Stopped.make({ reason: 'Offline' })),
        ),

      changeLobby: change => writeLobby(handles, change),

      room: code =>
        streamWithAccess(
          access =>
            Stream.unwrap(
              Effect.gen(function* () {
                const client = yield* connectRoom({
                  url: roomSocketUrl(API_ORIGIN, code),
                  token: access.token,
                })
                yield* Ref.set(handles.room, Option.some(client))
                return client.events
              }),
            ).pipe(Stream.ensuring(Ref.set(handles.room, Option.none()))),
          Stream.make(RoomEvent.cases.Stopped.make({ reason: 'Offline' })),
        ),

      sendToRoom: frames =>
        Effect.flatMap(Ref.get(handles.room), maybeRoom =>
          Option.match(maybeRoom, {
            onNone: () => Effect.succeed<ReadonlyArray<number>>([]),
            onSome: client =>
              Effect.map(Effect.forEach(frames, client.send), Array.getSomes),
          }),
        ),

      leaveRoom: Effect.gen(function* () {
        yield* Effect.ignore(writeLobby(handles, 'Left'))
        const maybeRoom = yield* Ref.get(handles.room)
        if (Option.isSome(maybeRoom)) {
          yield* maybeRoom.value.leave
        }
        yield* Effect.sleep(LEAVE_SETTLE)
      }),

      resyncRoom: Effect.flatMap(Ref.get(handles.room), maybeRoom =>
        Option.match(maybeRoom, {
          onNone: () => Effect.void,
          onSome: client => client.resync,
        }),
      ),
    })
  })

export const layer: Layer.Layer<CoopNet, never, PlayerStore> = Layer.effect(
  CoopNet,
  Effect.gen(function* () {
    const store = yield* PlayerStore
    const maybeAccess = yield* Effect.cached(
      API_ORIGIN === ''
        ? Effect.succeed(Option.none<RoomAccess>())
        : store.roomAccess,
    )
    const live = yield* Effect.cached(Effect.flatMap(maybeAccess, liveOf))
    const use = <A, E>(
      run: (net: CoopNet['Service']) => Effect.Effect<A, E>,
    ): Effect.Effect<A, E> => Effect.flatMap(live, run)
    const useStream = <A>(
      run: (net: CoopNet['Service']) => Stream.Stream<A>,
    ): Stream.Stream<A> => Stream.unwrap(Effect.map(live, run))
    return CoopNet.of({
      requestRoom: (request, name, look, rank, calling) =>
        use(net => net.requestRoom(request, name, look, rank, calling)),
      quickPlay: (name, look, rank, calling) =>
        useStream(net => net.quickPlay(name, look, rank, calling)),
      answerOffer: accept => use(net => net.answerOffer(accept)),
      cancelQuickPlay: use(net => net.cancelQuickPlay),
      lobby: code => useStream(net => net.lobby(code)),
      changeLobby: change => use(net => net.changeLobby(change)),
      room: code => useStream(net => net.room(code)),
      sendToRoom: frames => use(net => net.sendToRoom(frames)),
      leaveRoom: use(net => net.leaveRoom),
      resyncRoom: use(net => net.resyncRoom),
    })
  }),
)
