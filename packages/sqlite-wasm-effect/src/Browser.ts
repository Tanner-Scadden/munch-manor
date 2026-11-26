import type { Duration, Layer } from 'effect'
import {
  Deferred,
  Effect,
  Exit,
  Option,
  Predicate,
  Queue,
  Ref,
  Schedule,
  type Scope,
  Stream,
  String,
  pipe,
} from 'effect'
import { SecureRandom } from 'effect/crypto'
import type { SqlClient } from 'effect/sql'

import {
  ChannelMessage,
  Persistence,
  Request,
  type Response,
  decodeChannelMessage,
  decodeResponse,
  encodeChannelMessage,
  encodeRequest,
} from './Protocol'
import { type Remote, type Sender, connectionError, makeRemote } from './Remote'
import type { SqliteClient } from './SqliteClient'
import {
  type ClientOptions,
  DEFAULT_OPEN_TIMEOUT,
  type DatabaseFile,
  type Role,
  SqliteOpenError,
  type Status,
  layerFromClient,
  makeClient,
  openThrough,
} from './SqliteClient'
import { describeError } from './describeError'

export interface BrowserOptions extends ClientOptions {
  readonly worker: () => Worker
  readonly leaderLock?: (() => Promise<LockResult> | undefined) | undefined
  readonly name?: string | undefined
  readonly file?: string | undefined
  readonly openTimeout?: Duration.Input | undefined
}

const DEFAULT_NAME = 'sqlite-wasm-effect'
const DEFAULT_FILE = '/main.sqlite3'
const FOLLOWER_ASK_INTERVAL: Duration.Input = '1 second'

export type LockResult = 'Granted' | 'Held'

type LockMode = 'IfAvailable' | 'Wait'

const hasLocks = (): boolean =>
  Predicate.hasProperty(globalThis, 'navigator') &&
  Predicate.hasProperty(globalThis.navigator, 'locks')

const acquireLock = (
  name: string,
  mode: LockMode,
): Effect.Effect<LockResult, never, Scope.Scope> =>
  Effect.gen(function* () {
    const released = yield* Deferred.make<void>()
    yield* Effect.addFinalizer(() => Deferred.done(released, Exit.void))
    const context = yield* Effect.context()
    const holdUntilReleased = Effect.runPromiseWith(context)
    return yield* Effect.callback<LockResult>((resume, signal) => {
      const hold = (lock: Lock | null): Promise<void> | undefined => {
        if (lock === null) {
          resume(Effect.succeed('Held'))
          return undefined
        }
        resume(Effect.succeed('Granted'))
        return holdUntilReleased(Deferred.await(released))
      }
      const request =
        mode === 'IfAvailable'
          ? navigator.locks.request(name, { ifAvailable: true }, hold)
          : navigator.locks.request(name, { signal }, hold)
      request.catch(() => undefined)
    })
  })

const listen = <A>(
  target: Pick<Worker, 'addEventListener' | 'removeEventListener'>,
  type: 'message' | 'error',
  read: (event: Event) => A,
): Effect.Effect<Stream.Stream<A>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<A>()
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listener = (event: Event): void => {
          Queue.offerUnsafe(queue, read(event))
        }
        target.addEventListener(type, listener)
        return listener
      }),
      listener => Effect.sync(() => target.removeEventListener(type, listener)),
    )
    return Stream.fromQueue(queue)
  })

const messagesOf = (
  target: Pick<Worker, 'addEventListener' | 'removeEventListener'>,
): Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope> =>
  listen(target, 'message', event =>
    Predicate.hasProperty(event, 'data') ? event.data : undefined,
  )

const errorsOf = (
  worker: Worker,
): Effect.Effect<Stream.Stream<string>, never, Scope.Scope> =>
  listen(worker, 'error', event =>
    Predicate.hasProperty(event, 'message') &&
    Predicate.isString(event.message) &&
    event.message !== ''
      ? event.message
      : 'The worker failed to load',
  )

const post =
  (target: { postMessage: (message: unknown) => void }) =>
  (message: unknown): Effect.Effect<void> =>
    pipe(
      Effect.try({
        try: () => target.postMessage(message),
        catch: cause => connectionError(describeError(cause), 'post'),
      }),
      Effect.ignore,
    )

const postChannel = (
  channel: Option.Option<BroadcastChannel>,
  message: ChannelMessage,
): Effect.Effect<void> =>
  Option.match(channel, {
    onNone: () => Effect.void,
    onSome: open =>
      pipe(
        encodeChannelMessage(message),
        Effect.flatMap(post(open)),
        Effect.ignore,
      ),
  })

const isOwn = (session: string, response: Response): boolean =>
  response._tag === 'Changed' ||
  (Predicate.hasProperty(response, 'id') &&
    Predicate.isString(response.id) &&
    String.startsWith(`${session}:`)(response.id))

const leading = (persistence: Persistence): Status => ({
  role: 'Leader',
  persistence,
})

const following = (persistence: Persistence): Status => ({
  role: 'Follower',
  persistence,
})

const lead = (
  remote: Remote,
  worker: Ref.Ref<Option.Option<Worker>>,
  channel: Option.Option<BroadcastChannel>,
  options: BrowserOptions,
): Effect.Effect<Sender, never, Scope.Scope> =>
  Effect.gen(function* () {
    const started = yield* Effect.acquireRelease(
      Effect.sync(() => options.worker()),
      running => Effect.sync(() => running.terminate()),
    )
    yield* Ref.set(worker, Option.some(started))
    const sendToWorker = (request: Request): Effect.Effect<void> =>
      pipe(encodeRequest(request), Effect.flatMap(post(started)), Effect.ignore)
    const sender: Sender = { send: sendToWorker }

    const workerMessages = yield* messagesOf(started)
    const workerErrors = yield* errorsOf(started)
    yield* pipe(
      workerMessages,
      Stream.runForEach(data =>
        pipe(
          decodeResponse(data),
          Effect.flatMap(response =>
            Effect.andThen(
              isOwn(remote.session, response)
                ? remote.receive(response)
                : Effect.void,
              isOwn(remote.session, response) && response._tag !== 'Changed'
                ? Effect.void
                : postChannel(
                    channel,
                    ChannelMessage.cases.Answer.make({ response }),
                  ),
            ),
          ),
          Effect.ignore,
        ),
      ),
      Effect.forkScoped,
    )

    yield* pipe(
      workerErrors,
      Stream.runForEach(reason =>
        remote.useSender(sender, `The database worker failed: ${reason}`),
      ),
      Effect.forkScoped,
    )

    return sender
  })

export const layer = (
  options: BrowserOptions,
): Layer.Layer<SqliteClient | SqlClient.SqlClient, SqliteOpenError> =>
  layerFromClient(
    Effect.gen(function* () {
      const name = options.name ?? DEFAULT_NAME
      const database: DatabaseFile = {
        file: options.file ?? DEFAULT_FILE,
        directory: `.${name}`,
      }
      const openTimeout = options.openTimeout ?? DEFAULT_OPEN_TIMEOUT
      const session = yield* Effect.sync(() => SecureRandom.uuidV4Unsafe())
      const channel = yield* pipe(
        Effect.acquireRelease(
          Effect.try({
            try: () => new BroadcastChannel(`${name}:channel`),
            catch: error =>
              SqliteOpenError.make({ reason: describeError(error) }),
          }),
          open => Effect.sync(() => open.close()),
        ),
        Effect.option,
      )
      const worker = yield* Ref.make<Option.Option<Worker>>(Option.none())
      const role = yield* Ref.make<Role>('Follower')

      const askLeader: Sender = {
        send: request =>
          postChannel(channel, ChannelMessage.cases.Ask.make({ request })),
      }
      const remote = yield* makeRemote(session, askLeader)

      const maybeEarlyLock = options.leaderLock?.()
      const firstLock: LockResult =
        maybeEarlyLock !== undefined
          ? yield* Effect.promise(() => maybeEarlyLock)
          : hasLocks()
            ? yield* acquireLock(`${name}:leader`, 'IfAvailable')
            : 'Granted'

      const status = yield* Ref.make<Status>({
        role: 'Follower',
        persistence: Persistence.cases.Memory.make({ reason: 'Not open yet' }),
      })

      const openAsLeader = Effect.gen(function* () {
        const sender = yield* lead(remote, worker, channel, options)
        yield* Ref.set(role, 'Leader')
        yield* remote.useSender(sender, 'This tab became the leader')
        const persistence = yield* openThrough(remote, database, openTimeout)
        yield* Ref.set(status, leading(persistence))
        yield* postChannel(
          channel,
          ChannelMessage.cases.LeaderChanged.make({ leader: session }),
        )
      })

      const openAsFollower = pipe(
        openThrough(remote, database, FOLLOWER_ASK_INTERVAL),
        Effect.retry(Schedule.spaced('100 millis')),
        Effect.timeoutOrElse({
          duration: openTimeout,
          orElse: () =>
            Effect.fail(
              SqliteOpenError.make({ reason: 'No leader tab answered' }),
            ),
        }),
        Effect.flatMap(persistence => Ref.set(status, following(persistence))),
      )

      const handleChannel = (
        message: ChannelMessage,
      ): Effect.Effect<void, never, Scope.Scope> =>
        Effect.gen(function* () {
          const current = yield* Ref.get(role)
          if (current === 'Leader' && message._tag === 'Ask') {
            const running = yield* Ref.get(worker)
            yield* Option.match(running, {
              onNone: () => Effect.void,
              onSome: started =>
                pipe(
                  encodeRequest(message.request),
                  Effect.flatMap(post(started)),
                  Effect.ignore,
                ),
            })
          } else if (current === 'Follower' && message._tag === 'Answer') {
            yield* remote.receive(message.response)
          } else if (
            current === 'Follower' &&
            message._tag === 'LeaderChanged'
          ) {
            yield* remote.useSender(askLeader, 'The leader tab changed')
            yield* pipe(openAsFollower, Effect.ignore, Effect.forkScoped)
          }
        })

      yield* Option.match(channel, {
        onNone: () => Effect.void,
        onSome: open =>
          pipe(
            messagesOf(open),
            Effect.flatMap(
              Stream.runForEach(data =>
                pipe(
                  decodeChannelMessage(data),
                  Effect.flatMap(handleChannel),
                  Effect.ignore,
                ),
              ),
            ),
            Effect.forkScoped,
            Effect.asVoid,
          ),
      })

      if (firstLock === 'Granted') {
        yield* openAsLeader.pipe(
          Effect.mapError(error =>
            SqliteOpenError.make({ reason: describeError(error) }),
          ),
        )
      } else {
        yield* openAsFollower
        yield* pipe(
          acquireLock(`${name}:leader`, 'Wait'),
          Effect.andThen(openAsLeader),
          Effect.ignore,
          Effect.forkScoped,
        )
      }

      yield* Effect.addFinalizer(() =>
        Effect.flatMap(Ref.get(role), current =>
          current === 'Follower'
            ? askLeader.send(Request.cases.Release.make({ session }))
            : Effect.void,
        ),
      )

      return yield* makeClient(remote, status, options)
    }),
  )
