import { Array, Order, Predicate, Record } from 'effect'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Redacted from 'effect/Redacted'
import * as SecureRandom from 'effect/crypto/SecureRandom'
import {
  type EventJournal,
  EventLog,
  EventLogMessage,
  EventLogServer,
  EventLogServerUnencrypted,
  SqlEventLogServerUnencrypted,
} from 'effect/eventlog'
import type { Rpc } from 'effect/rpc'

import { PlayerLogSchema } from '../../src/platform/save/playerEvents.ts'
import {
  PlayerHandlers,
  createPlayerTables,
} from '../../src/platform/save/playerProjection.ts'
import {
  type LinkCode,
  PlayerLogRpcs,
  SessionRefused,
  SessionRpcs,
  playerStoreOf,
} from '../../src/shared/records/sessionApi.ts'
import { sessionUnavailable } from './linkCodes.ts'
import { SESSION_TTL_MS, signToken } from './sessionToken.ts'

export const CHANGES_TAG = EventLogMessage.ChangesRpc._tag
export const AUTHENTICATE_TAG = EventLogMessage.AuthenticateRpc._tag

export const authenticatedKeyOf = (payload: unknown): Option.Option<string> =>
  Predicate.hasProperty(payload, 'publicKey') &&
  typeof payload.publicKey === 'string'
    ? Option.some(payload.publicKey)
    : Option.none()

export interface LinkCodeRequest {
  readonly publicKey: string
  readonly identity: string
}

export interface PlayerLogOptions {
  readonly isHere: (storeId: string) => boolean
  readonly secret: string
  readonly issueLinkCode: (
    request: LinkCodeRequest,
  ) => Effect.Effect<LinkCode, SessionRefused>
  readonly sessionOf: (clientId: number) => Option.Option<string>
}

class SocketDevice extends Context.Service<SocketDevice, string>()(
  'munch-manor-infra/worker/playerLogCore/SocketDevice',
) {}

const forbidden = (publicKey: string, storeId: string) =>
  new EventLogServerUnencrypted.EventLogServerAuthError({
    reason: 'Forbidden',
    publicKey,
    message: `${publicKey} may not use ${storeId}`,
  })

const ownerOnly = (publicKey: string, storeId: string) =>
  storeId === playerStoreOf(publicKey)
    ? Effect.void
    : Effect.fail(forbidden(publicKey, storeId))

const OwnerOnly = Layer.succeed(
  EventLogServerUnencrypted.EventLogServerAuthorization,
  {
    authorizeWrite: ({ publicKey, storeId }) => ownerOnly(publicKey, storeId),
    authorizeRead: ({ publicKey, storeId }) => ownerOnly(publicKey, storeId),
    authorizeIdentity: () => Effect.void,
  },
)

const pinnedTo = (isHere: (storeId: string) => boolean) =>
  Layer.succeed(EventLogServerUnencrypted.StoreMapping, {
    resolve: ({ storeId, publicKey }) =>
      isHere(storeId)
        ? Effect.succeed(storeId)
        : Effect.fail(
            new EventLogServerUnencrypted.EventLogServerStoreError({
              reason: 'NotFound',
              publicKey,
              storeId,
              message: `${storeId} does not live here`,
            }),
          ),
    hasStore: ({ storeId }) => Effect.succeed(isHere(storeId)),
  })

const PlayerProjection = Layer.effectDiscard(createPlayerTables).pipe(
  Layer.provideMerge(PlayerHandlers),
)

const ENTRIES_PER_STATEMENT = 16
const ENTRIES_PER_EVENT_LOOKUP = 4
const EVENTS_PER_LOOKUP = 4

const lookupChunksOf = (
  batch: ReadonlyArray<EventJournal.Entry>,
): Array<Array.NonEmptyArray<EventJournal.Entry>> =>
  Array.map(
    Array.chunksOf(
      Array.flatMap(
        Record.values(Array.groupBy(batch, entry => entry.event)),
        sameEvent => Array.chunksOf(sameEvent, ENTRIES_PER_EVENT_LOOKUP),
      ),
      EVENTS_PER_LOOKUP,
    ),
    chunk => Array.flatten(chunk),
  )

const bySequence = Order.mapInput(
  Order.Number,
  (remoteEntry: EventJournal.RemoteEntry) => remoteEntry.remoteSequence,
)

const oncePerSequence = (
  remoteEntries: ReadonlyArray<EventJournal.RemoteEntry>,
): Array<EventJournal.RemoteEntry> =>
  Array.sort(
    Array.dedupeWith(
      remoteEntries,
      (left, right) => left.remoteSequence === right.remoteSequence,
    ),
    bySequence,
  )

export const DurableObjectStorage = Layer.effect(
  EventLogServerUnencrypted.Storage,
  Effect.map(
    SqlEventLogServerUnencrypted.makeStorage({
      insertBatchSize: ENTRIES_PER_STATEMENT,
    }),
    storage =>
      EventLogServerUnencrypted.Storage.of({
        ...storage,
        entriesAfter: (storeId, entry, batch) =>
          batch === undefined
            ? storage.entriesAfter(storeId, entry)
            : Effect.map(
                Effect.forEach(lookupChunksOf(batch), chunk =>
                  storage.entriesAfter(storeId, entry, chunk),
                ),
                chunks => oncePerSequence(Array.flatten(chunks)),
              ),
      }),
  ),
)

const restoreSession = (
  client: Rpc.ServerClient,
  sessionOf: (clientId: number) => Option.Option<string>,
): void => {
  Option.map(sessionOf(client.id), publicKey => {
    const known = Context.getOption(
      client.annotations,
      EventLogServer.AuthenticatedIdentities,
    )
    if (Option.exists(known, keys => keys.has(publicKey))) {
      return
    }
    client
      .annotate(EventLog.Identity, {
        publicKey,
        privateKey: Redacted.make(new Uint8Array(32)),
      })
      .annotate(EventLogServer.AuthenticatedIdentities, new Set([publicKey]))
  })
}

const isHandler = (entry: unknown): entry is Rpc.Handler<string> =>
  Predicate.hasProperty(entry, 'handler') && Predicate.isFunction(entry.handler)

const restoringSessions = <A, E, R>(
  handlers: Layer.Layer<A, E, R>,
  sessionOf: (clientId: number) => Option.Option<string>,
): Layer.Layer<A, E, R> =>
  handlers.pipe(
    Layer.build,
    Effect.map(context => {
      const entries = new Map(context.mapUnsafe)
      Array.forEach(
        globalThis.Array.from(PlayerLogRpcs.requests.values()),
        rpc => {
          const entry: unknown = entries.get(rpc.key)
          if (!isHandler(entry)) {
            return
          }
          const wrapped: Rpc.Handler<string> = {
            ...entry,
            handler: (payload, options) => {
              restoreSession(options.client, sessionOf)
              return entry.handler(payload, options)
            },
          }
          entries.set(rpc.key, wrapped)
        },
      )
      return Context.makeUnsafe<A>(entries)
    }),
    Layer.effectContext,
  )

const notSignedIn = () => SessionRefused.make({ problem: 'NotSignedIn' })

const signedInKey = (
  client: Rpc.ServerClient,
  isHere: (storeId: string) => boolean,
): Effect.Effect<string, SessionRefused> =>
  Option.flatMap(
    Context.getOption(
      client.annotations,
      EventLogServer.AuthenticatedIdentities,
    ),
    keys =>
      Array.findFirst(globalThis.Array.from(keys), key =>
        isHere(playerStoreOf(key)),
      ),
  ).pipe(Effect.fromOption, Effect.mapError(notSignedIn))

const deviceOf = (client: Rpc.ServerClient): Effect.Effect<string> =>
  Option.match(Context.getOption(client.annotations, SocketDevice), {
    onSome: Effect.succeed,
    onNone: () =>
      Effect.sync(() => {
        const deviceId = SecureRandom.uuidV4Unsafe()
        client.annotate(SocketDevice, deviceId)
        return deviceId
      }),
  })

const identityKeyOf = (
  identity: string,
): Effect.Effect<string, SessionRefused> =>
  Effect.try({
    try: () => EventLog.decodeIdentityString(identity).publicKey,
    catch: notSignedIn,
  })

const sessionHandlers = (options: PlayerLogOptions) =>
  SessionRpcs.toLayer({
    'Session.Mint': (_, { client }) =>
      Effect.gen(function* () {
        const playerId = yield* signedInKey(client, options.isHere)
        const deviceId = yield* deviceOf(client)
        const nowMs = yield* Clock.currentTimeMillis
        const expiresMs = nowMs + SESSION_TTL_MS
        const token = yield* Effect.mapError(
          signToken(options.secret, { deviceId, playerId, expiresMs }),
          sessionUnavailable,
        )
        return { token, expiresMs }
      }),
    'Session.CreateLinkCode': ({ identity }, { client }) =>
      Effect.gen(function* () {
        const publicKey = yield* signedInKey(client, options.isHere)
        const offered = yield* identityKeyOf(identity)
        if (offered !== publicKey) {
          return yield* notSignedIn()
        }
        return yield* options.issueLinkCode({ publicKey, identity })
      }),
  })

export const playerLogHandlers = (options: PlayerLogOptions) =>
  restoringSessions(
    Layer.mergeAll(
      EventLogServerUnencrypted.layerNoRpcServer(
        PlayerLogSchema,
        PlayerProjection,
      ),
      sessionHandlers(options),
    ),
    options.sessionOf,
  ).pipe(
    Layer.provide([OwnerOnly, pinnedTo(options.isHere), DurableObjectStorage]),
  )
