import type { Array } from 'effect'
import { Effect, Option, Ref, Result, Schema, Stream, pipe } from 'effect'

import {
  type Lobby,
  RoomScope,
  lobbyOfSnapshot,
  roomScopeId,
} from '@munch/netcode'
import { TokenUnavailable } from '@munch/netcode/browser'
import {
  type DeviceIdentity,
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

import { writeLobbyChange } from './lobbyWrite'
import type { CoopProblem, LobbyChange } from './model'

// NOTE: co-op's side of the player database, built in the store's own chunk
// (src/storeSqlite.ts) and handed to the game through PlayerStore. The room
// lobby is the `room:<code>` sync scope (packages/netcode/src/Lobby.ts),
// followed here by a real Replica in the same SQLite file as the save: one
// `room` replica, switched to each room the player enters. Only the leader
// tab runs sync, so a follower tab follows the lobby over its own socket
// instead (see src/coop/net.ts).

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

type RoomAccessOptions = Readonly<{
  database: LocalDatabase
  identity: DeviceIdentity
  transports: Array.NonEmptyReadonlyArray<Transport>
}>

const toAccessError = (error: { readonly message: string }) =>
  RoomAccessError.make({ reason: error.message })

/** @stability unstable */
export const makeRoomAccess = ({
  database,
  identity,
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
              identity.session,
              Effect.mapBoth({
                onSuccess: session => ({ token: session.token, clientId }),
                onFailure: error =>
                  TransportError.make({ reason: error.failure._tag }),
              }),
            ),
            refreshCredentials: identity.invalidate,
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
      playerId: Effect.mapError(identity.playerId, error =>
        RoomAccessError.make({ reason: error.failure._tag }),
      ),
      token: pipe(
        identity.session,
        Effect.mapBoth({
          onSuccess: session => session.token,
          onFailure: error =>
            TokenUnavailable.make({ reason: error.failure._tag }),
        }),
      ),
      canFollow: Effect.map(database.role, role => role === 'Leader'),
      followRoom,
      writeRoom: (by: string, change: LobbyChange | 'Left') =>
        writeLobbyChange(writeMutation, by, change),
    }
  })
