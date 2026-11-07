import {
  Array,
  Clock,
  Duration,
  Effect,
  PubSub,
  Ref,
  Schedule,
  Schema,
  type Scope,
  Stream,
  SubscriptionRef,
  pipe,
} from 'effect'
import type { SqlError } from 'effect/sql'

import {
  type ClientMessage,
  type HelloMode,
  PROTOCOL_VERSION,
  type ServerMessage,
} from './Protocol'
import { Receipt, type Replica } from './Replica'
import { mutationVersions } from './Scope'

// TRANSPORT

export class TransportError extends Schema.TaggedError<
  TransportError,
  { readonly brand: unique symbol }
>()('TransportError', {
  reason: Schema.String,
}) {}

// NOTE: one open connection to a scope's authority. A WebSocket is one; the
// HTTP fallback emulates one by posting batches. `messages` ends or fails
// when the connection is gone.
export interface Channel {
  readonly send: (message: ClientMessage) => Effect.Effect<void, TransportError>
  readonly messages: Stream.Stream<ServerMessage, TransportError>
}

export interface Transport {
  readonly name: string
  readonly open: (
    scope: string,
  ) => Effect.Effect<Channel, TransportError, Scope.Scope>
}

export interface Credentials {
  readonly token: string
  readonly clientId: string
}

// STATUS

export const SyncStatus = Schema.TaggedUnion({
  Following: {},
  Connecting: { attempt: Schema.Finite },
  Online: { transport: Schema.String },
  Offline: { reason: Schema.String },
})
export type SyncStatus = typeof SyncStatus.Type

// OPTIONS

/** @stability unstable */
export interface SyncOptions {
  readonly replica: Replica
  readonly transports: Array.NonEmptyReadonlyArray<Transport>
  readonly credentials: Effect.Effect<Credentials, TransportError>
  readonly refreshCredentials?: Effect.Effect<void> | undefined
  readonly heartbeat?: Duration.Input | undefined
  readonly silence?: Duration.Input | undefined
  readonly resendEvery?: Duration.Input | undefined
  readonly followerPoll?: Duration.Input | undefined
  readonly backoff?: Schedule.Schedule<unknown> | undefined
  readonly fallbackAfter?: number | undefined
}

export interface Sync {
  readonly status: Stream.Stream<SyncStatus>
  readonly current: Effect.Effect<SyncStatus>
  readonly receipts: Stream.Stream<Receipt>
  readonly reconnect: Effect.Effect<void>
}

// NOTE: half a second, doubling, never more than 15 seconds apart, with
// jitter so a fleet of clients does not reconnect in step after an outage.
export const DEFAULT_BACKOFF: Schedule.Schedule<unknown> = Schedule.jittered(
  Schedule.min([
    Schedule.exponential('500 millis'),
    Schedule.spaced('15 seconds'),
  ]),
)

const DEFAULT_HEARTBEAT: Duration.Input = '25 seconds'
const DEFAULT_SILENCE: Duration.Input = '60 seconds'
const DEFAULT_RESEND: Duration.Input = '15 seconds'
const DEFAULT_FOLLOWER_POLL: Duration.Input = '2 seconds'
const DEFAULT_FALLBACK_AFTER = 2

class Dropped extends Schema.TaggedError<
  Dropped,
  { readonly brand: unique symbol }
>()('Dropped', {
  reason: Schema.String,
}) {}

const fromSql = (error: SqlError.SqlError) =>
  TransportError.make({ reason: `Local database: ${error.message}` })

// SYNC

// NOTE: the client's side of the connection, in the leader tab only. A
// follower tab writes its mutations through the leader's database, and the
// leader's loop sees them in `localChanges` and pushes them. Each session:
// credentials, open a channel, Hello with the confirmed seq, then apply
// whatever comes back while pushing pending mutations. A session that got
// online and then dropped reconnects at once; one that never got online
// waits out the backoff. After `fallbackAfter` failures in a row on the
// first transport (the WebSocket) the next one (HTTP) is tried.
/** @stability unstable */
export const startSync = (
  options: SyncOptions,
): Effect.Effect<Sync, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { replica } = options
    const heartbeat = options.heartbeat ?? DEFAULT_HEARTBEAT
    const silenceMs = Duration.toMillis(
      Duration.fromInputUnsafe(options.silence ?? DEFAULT_SILENCE),
    )
    const resendEvery = options.resendEvery ?? DEFAULT_RESEND
    const followerPoll = options.followerPoll ?? DEFAULT_FOLLOWER_POLL
    const backoff = options.backoff ?? DEFAULT_BACKOFF
    const fallbackAfter = options.fallbackAfter ?? DEFAULT_FALLBACK_AFTER
    const versions = mutationVersions(replica.definition)

    const status = yield* SubscriptionRef.make<SyncStatus>(
      SyncStatus.cases.Connecting.make({ attempt: 0 }),
    )
    const receipts = yield* PubSub.unbounded<Receipt>()
    const failures = yield* Ref.make(0)
    const leading = yield* Ref.make(false)
    const kicks = yield* PubSub.unbounded<void>()

    const setStatus = (next: SyncStatus) => SubscriptionRef.set(status, next)

    const session = (
      transport: Transport,
    ): Effect.Effect<void, TransportError | Dropped> =>
      Effect.scoped(
        Effect.gen(function* () {
          // NOTE: subscribed before the scope is read. A device linked while
          // this session connects switches its scope and kicks; a kick sent
          // before the watch below started would be lost, and the session
          // would stay on the old scope until the next reconnect.
          const kicked = yield* PubSub.subscribe(kicks)
          const credentials = yield* options.credentials
          const scope = yield* Effect.mapError(replica.scope, fromSql)
          const channel = yield* transport.open(scope)
          const online = yield* Ref.make(false)
          const inFlight = yield* Ref.make<ReadonlyArray<string>>([])
          const currentTimeMillis_1 = yield* Clock.currentTimeMillis
          const lastHeard = yield* Ref.make(currentTimeMillis_1)

          const hello = (mode: HelloMode) =>
            Effect.flatMap(
              Effect.mapError(replica.confirmedSeq, fromSql),
              lastSeq =>
                channel.send({
                  _tag: 'Hello',
                  protocol: PROTOCOL_VERSION,
                  scope,
                  lastSeq,
                  mode,
                  clientId: credentials.clientId,
                  token: credentials.token,
                  versions,
                }),
            )

          const push = (resendAll: boolean) =>
            Effect.gen(function* () {
              if (!(yield* Ref.get(online))) {
                return
              }
              const pending = yield* Effect.mapError(replica.pending, fromSql)
              const sent = yield* Ref.get(inFlight)
              const toSend = resendAll
                ? pending
                : Array.filter(
                    pending,
                    envelope => !Array.contains(sent, envelope.id),
                  )
              if (Array.isReadonlyArrayNonEmpty(toSend)) {
                yield* Ref.set(
                  inFlight,
                  Array.dedupe(
                    Array.appendAll(
                      sent,
                      Array.map(toSend, envelope => envelope.id),
                    ),
                  ),
                )
                yield* channel.send({ _tag: 'Push', mutations: toSend })
              }
            })

          const settle = (id: string) =>
            Ref.update(inFlight, ids => Array.filter(ids, sent => sent !== id))

          const handle = (message: ServerMessage) =>
            Effect.gen(function* () {
              const currentTimeMillis_2 = yield* Clock.currentTimeMillis
              yield* Ref.set(lastHeard, currentTimeMillis_2)
              const receipt = yield* Effect.mapError(
                replica.receive(message),
                fromSql,
              )
              yield* Receipt.match(receipt, {
                Applied: () =>
                  Effect.gen(function* () {
                    if (!(yield* Ref.get(online))) {
                      yield* Ref.set(online, true)
                      yield* Ref.set(failures, 0)
                      yield* setStatus(
                        SyncStatus.cases.Online.make({
                          transport: transport.name,
                        }),
                      )
                      yield* push(true)
                    }
                  }),
                Resync: ({ mode }) => hello(mode),
                Confirmed: confirmed =>
                  Effect.andThen(
                    settle(confirmed.id),
                    PubSub.publish(receipts, confirmed),
                  ),
                Rejected: rejected =>
                  Effect.andThen(
                    settle(rejected.id),
                    PubSub.publish(receipts, rejected),
                  ),
                Failed: failure =>
                  Effect.gen(function* () {
                    if (failure.code === 'Unauthorized') {
                      yield* options.refreshCredentials ?? Effect.void
                    }
                    yield* PubSub.publish(receipts, failure)
                    return yield* TransportError.make({
                      reason: `${failure.code}: ${failure.reason}`,
                    })
                  }),
                Ignored: () => Effect.void,
              })
            })

          const watchdog = Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const heard = yield* Ref.get(lastHeard)
            if (now - heard > silenceMs) {
              return yield* Dropped.make({ reason: 'The server went quiet' })
            }
          }).pipe(
            Effect.repeat(Schedule.spaced(Duration.millis(silenceMs / 4))),
          )

          // NOTE: checks once at the start too, for a switch another tab
          // made before the watch subscribed to the database's changes.
          const scopeWatch = pipe(
            Stream.mergeAll(
              [
                Stream.make(undefined),
                replica.remoteChanges,
                Stream.fromSubscription(kicked),
              ],
              { concurrency: 'unbounded' },
            ),
            Stream.runForEach(() =>
              Effect.flatMap(
                Effect.mapError(replica.scope, fromSql),
                current =>
                  current === scope
                    ? Effect.void
                    : Effect.fail(Dropped.make({ reason: 'Scope changed' })),
              ),
            ),
          )

          const pushes = Stream.runForEach(replica.localChanges, () =>
            push(false),
          )

          const resends = Effect.repeat(
            push(true),
            Schedule.spaced(resendEvery),
          )

          const pings = Effect.repeat(
            channel.send({ _tag: 'Ping' }),
            Schedule.spaced(heartbeat),
          )

          const receiving = Effect.andThen(
            Stream.runForEach(channel.messages, handle),
            Effect.fail(Dropped.make({ reason: 'Connection closed' })),
          )

          yield* hello('Catchup')

          const ended = yield* Effect.exit(
            Effect.raceAllFirst([
              receiving,
              watchdog,
              scopeWatch,
              Effect.andThen(
                Effect.all([pushes, resends, pings], {
                  concurrency: 'unbounded',
                  discard: true,
                }),
                Effect.never,
              ),
            ]),
          )
          const wasOnline = yield* Ref.get(online)
          if (ended._tag === 'Failure' && !wasOnline) {
            return yield* Effect.failCause(ended.cause)
          }
        }),
      )

    const attempt: Effect.Effect<void, TransportError | Dropped> = Effect.gen(
      function* () {
        const role = yield* replica.role
        if (role === 'Follower') {
          yield* Ref.set(leading, false)
          yield* setStatus(SyncStatus.cases.Following.make({}))
          return yield* Effect.sleep(followerPoll)
        }
        const wasLeading = yield* Ref.getAndSet(leading, true)
        yield* Effect.mapError(
          replica.startSession(wasLeading ? 'Reconnecting' : 'Leading'),
          fromSql,
        )
        const failed = yield* Ref.get(failures)
        const transport =
          failed >= fallbackAfter && options.transports.length > 1
            ? Array.lastNonEmpty(options.transports)
            : Array.headNonEmpty(options.transports)
        yield* setStatus(SyncStatus.cases.Connecting.make({ attempt: failed }))
        yield* pipe(
          session(transport),
          Effect.tapError(error =>
            Effect.andThen(
              Ref.update(failures, n => n + 1),
              setStatus(
                SyncStatus.cases.Offline.make({ reason: error.reason }),
              ),
            ),
          ),
        )
        yield* setStatus(
          SyncStatus.cases.Offline.make({ reason: 'Reconnecting' }),
        )
      },
    )

    yield* pipe(
      attempt,
      Effect.retry(backoff),
      Effect.forever,
      Effect.forkScoped,
    )

    return {
      status: SubscriptionRef.changes(status),
      current: SubscriptionRef.get(status),
      receipts: Stream.fromPubSub(receipts),
      reconnect: PubSub.publish(kicks, undefined).pipe(Effect.asVoid),
    }
  })
