import { Context, Effect, Function, Layer, Schema } from 'effect'
import { EventLog, EventLogRemote } from 'effect/eventlog'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'

import {
  PLAYER_LOG_PATH,
  PlayerLogRpcs,
  playerStoreOf,
} from '../../src/shared/sessionApi'

export type Identity = EventLog.Identity['Service']

export interface MintedSession {
  readonly playerId: string
  readonly token: string
  readonly expiresMs: number
}

export class SessionUnavailable extends Schema.TaggedError<
  SessionUnavailable,
  { readonly brand: unique symbol }
>()('SessionUnavailable', { reason: Schema.String }) {}

const socketUrlOf = (origin: string, publicKey: string): string => {
  const url = new URL(PLAYER_LOG_PATH, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('store', playerStoreOf(publicKey))
  return url.toString()
}

const playerLogProtocol = (url: string) =>
  RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerSchemaBinary()),
  )

const unavailable = (error: { readonly _tag: string }) =>
  SessionUnavailable.make({ reason: error._tag })

export const mintSession: {
  (
    identity: Identity,
  ): (origin: string) => Effect.Effect<MintedSession, SessionUnavailable>
  (
    origin: string,
    identity: Identity,
  ): Effect.Effect<MintedSession, SessionUnavailable>
} = Function.dual(
  2,
  (
    origin: string,
    identity: Identity,
  ): Effect.Effect<MintedSession, SessionUnavailable> =>
    Effect.gen(function* () {
      const protocol = yield* Layer.build(
        Layer.merge(
          playerLogProtocol(socketUrlOf(origin, identity.publicKey)),
          EventLog.layerRegistry,
        ),
      )
      const client = yield* Effect.provideContext(
        RpcClient.make(PlayerLogRpcs, { disableTracing: true }),
        protocol,
      )
      const remote = yield* Effect.provideContext(
        EventLogRemote.makeUnencrypted,
        Context.add(protocol, EventLogRemote.EventLogRemoteClient, client),
      )
      const minted = yield* Effect.provideService(
        remote.whenAuthenticated(client['Session.Mint']()),
        EventLog.Identity,
        identity,
      )
      return { playerId: identity.publicKey, ...minted }
    }).pipe(Effect.mapError(unavailable), Effect.scoped),
)
