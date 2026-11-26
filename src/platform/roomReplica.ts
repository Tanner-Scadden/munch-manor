import type { Array } from 'effect'
import { Effect, Option, Ref, Result, Schema, Stream, pipe } from 'effect'

import {
  type Lobby,
  RoomScope,
  lobbyOfSnapshot,
  roomScopeId,
} from '@munch/netcode'
import type { TokenUnavailable } from '@munch/netcode/browser'
import {
  type LocalDatabase,
  type Mutation,
  type Replica,
  type Row,
  type Transport,
  TransportError,
  makeReplica,
  randomId,
  startSync,
} from '@munch/sync-engine'

import type { CoopProblem, LobbyChange } from '#domain/coopRoom.ts'

import { writeLobbyChange } from './lobbyWrite.ts'

class RoomAccessError extends Schema.TaggedError<
  RoomAccessError,
  { readonly brand: unique symbol }
>()('RoomAccessError', {
  reason: Schema.String,
}) {}

export interface RoomAccess {
  readonly playerId: Effect.Effect<string, RoomAccessError>
  readonly token: Effect.Effect<string, TokenUnavailable>
  readonly canFollow: Effect.Effect<boolean>
  readonly followRoom: (code: string) => Stream.Stream<Lobby, RoomAccessError>
  readonly writeRoom: (
    by: string,
    change: LobbyChange | 'Left',
  ) => Effect.Effect<void, CoopProblem>
}

export interface RoomSession {
  readonly playerId: string
  readonly token: Effect.Effect<string, TokenUnavailable>
  readonly invalidate: Effect.Effect<void>
}

type RoomAccessOptions = Readonly<{
  database: LocalDatabase
  session: Effect.Effect<RoomSession>
  transports: Array.NonEmptyReadonlyArray<Transport>
}>

export type { Transport }

export const browserTransports = (
  origin: string,
): Effect.Effect<Array.NonEmptyReadonlyArray<Transport>> =>
  Effect.map(
    Effect.promise(() => import('@munch/sync-engine/browser')),
    browser => [
      browser.webSocketTransport(origin),
      browser.httpTransport(origin),
    ],
  )

const toAccessError = (error: { readonly message: string }) =>
  RoomAccessError.make({ reason: error.message })

export const makeRoomAccess = ({
  database,
  session,
  transports,
}: RoomAccessOptions): Effect.Effect<RoomAccess> =>
  Effect.gen(function* () {
    const current = yield* Ref.make<Option.Option<Replica>>(Option.none())
    const sql = database.sql

    const readLobby = Effect.gen(function* () {
      const room = yield* sql<Row>`SELECT * FROM room`
      const members = yield* sql<Row>`SELECT * FROM members`
      return lobbyOfSnapshot({ room, members })
    })

    const replicaFor = (code: string) =>
      Effect.gen(function* () {
        const scope = roomScopeId(code)
        const replica = yield* makeReplica({
          definition: RoomScope,
          database,
          scope,
        })
        if ((yield* replica.scope) !== scope) {
          yield* replica.switchScope(scope)
        }
        yield* Ref.set(current, Option.some(replica))
        return replica
      })

    const followRoom = (code: string): Stream.Stream<Lobby, RoomAccessError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const replica = yield* Effect.mapError(
            replicaFor(code),
            toAccessError,
          )
          const clientId = yield* randomId(9)
          yield* startSync({
            replica,
            transports,
            credentials: pipe(
              Effect.flatMap(session, active => active.token),
              Effect.mapBoth({
                onSuccess: token => ({ token, clientId }),
                onFailure: error =>
                  TransportError.make({ reason: error.reason }),
              }),
            ),
            refreshCredentials: Effect.flatMap(
              session,
              active => active.invalidate,
            ),
          })
          return pipe(
            Stream.concat(
              Stream.make(undefined),
              Stream.merge(replica.remoteChanges, replica.localChanges),
            ),
            Stream.mapEffect(() => Effect.mapError(readLobby, toAccessError)),
            Stream.filterMap(maybeLobby =>
              Option.match(maybeLobby, {
                onNone: () => Result.failVoid,
                onSome: lobby =>
                  lobby.code === code ? Result.succeed(lobby) : Result.failVoid,
              }),
            ),
            Stream.ensuring(Ref.set(current, Option.none())),
          )
        }),
      )

    const writeMutation = <A, I>(
      mutation: Mutation<string, A, I>,
      args: NoInfer<A>,
    ) =>
      Effect.gen(function* () {
        const maybeReplica = yield* Ref.get(current)
        if (Option.isNone(maybeReplica)) {
          return yield* RoomAccessError.make({ reason: 'Not in a room' })
        }
        return yield* Effect.mapError(
          maybeReplica.value.run(mutation, args),
          error => RoomAccessError.make({ reason: String(error) }),
        )
      })

    return {
      playerId: Effect.map(session, active => active.playerId),
      token: Effect.flatMap(session, active => active.token),
      canFollow: Effect.map(database.role, role => role === 'Leader'),
      followRoom,
      writeRoom: (by: string, change: LobbyChange | 'Left') =>
        writeLobbyChange(writeMutation, by, change),
    }
  })
