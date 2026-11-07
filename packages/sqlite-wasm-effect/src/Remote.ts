import type { Duration } from 'effect'
import {
  Deferred,
  Effect,
  Function,
  MutableHashMap,
  MutableRef,
  Option,
  PubSub,
  Ref,
  pipe,
} from 'effect'
import { SqlError } from 'effect/sql'

import {
  type DatabaseFailure,
  Request,
  Response,
  type TableChange,
} from './Protocol'

// REMOTE

// NOTE: the main thread side of the protocol. Each call gets an id made of
// the session and a counter, so ids never clash between tabs. A response is
// matched to its call by id; a Changed response goes to `changes`. The
// sender can be swapped, as when a follower tab becomes the leader, and
// every call still in flight then fails at once instead of timing out.
export interface Sender {
  readonly send: (request: Request) => Effect.Effect<void>
}

/** @stability unstable */
export interface Remote {
  readonly session: string
  readonly call: (
    makeRequest: (id: string) => Request,
    timeout: Duration.Input,
    operation: string,
  ) => Effect.Effect<Response, SqlError.SqlError>
  readonly receive: (response: Response) => Effect.Effect<void>
  readonly useSender: (sender: Sender, reason: string) => Effect.Effect<void>
  readonly changes: PubSub.PubSub<ReadonlyArray<TableChange>>
}

/** @stability unstable */
export const connectionError: {
  (operation: string): (message: string) => SqlError.SqlError
  (message: string, operation: string): SqlError.SqlError
} = Function.dual(2, (message: string, operation: string): SqlError.SqlError =>
  SqlError.SqlError.make({
    reason: SqlError.ConnectionError.make({
      message,
      operation,
      cause: message,
    }),
  }),
)

/** @stability unstable */
export const databaseError: {
  (operation: string): (failure: DatabaseFailure) => SqlError.SqlError
  (failure: DatabaseFailure, operation: string): SqlError.SqlError
} = Function.dual(
  2,
  (failure: DatabaseFailure, operation: string): SqlError.SqlError =>
    SqlError.SqlError.make({
      reason: SqlError.classifySqliteError(failure, {
        message: failure.message,
        operation,
      }),
    }),
)

const timeoutError = (operation: string): SqlError.SqlError =>
  SqlError.SqlError.make({
    reason: SqlError.StatementTimeoutError.make({
      message: 'The database did not answer in time',
      operation,
      cause: 'timeout',
    }),
  })

const responseId = (response: Response): Option.Option<string> =>
  Response.match(response, {
    Opened: ({ id }) => Option.some(id),
    OpenFailed: ({ id }) => Option.some(id),
    Rows: ({ id }) => Option.some(id),
    Failed: ({ id }) => Option.some(id),
    Changed: () => Option.none(),
  })

/** @stability unstable */
export const makeRemote: {
  (initialSender: Sender): (session: string) => Effect.Effect<Remote>
  (session: string, initialSender: Sender): Effect.Effect<Remote>
} = Function.dual(
  2,
  (session: string, initialSender: Sender): Effect.Effect<Remote> =>
    Effect.gen(function* () {
      const pending = MutableHashMap.empty<
        string,
        Deferred.Deferred<Response, SqlError.SqlError>
      >()
      const counter = MutableRef.make(0)
      const sender = yield* Ref.make(initialSender)
      const changes = yield* PubSub.unbounded<ReadonlyArray<TableChange>>()

      const nextId = (): string => {
        const count = MutableRef.incrementAndGet(counter)
        return `${session}:${count}`
      }

      const send = (request: Request): Effect.Effect<void> =>
        Effect.flatMap(Ref.get(sender), current => current.send(request))

      const call: Remote['call'] = (makeRequest, timeout, operation) =>
        Effect.suspend(() => {
          const id = nextId()
          const deferred = Deferred.makeUnsafe<Response, SqlError.SqlError>()
          MutableHashMap.set(pending, id, deferred)
          return pipe(
            send(makeRequest(id)),
            Effect.andThen(Deferred.await(deferred)),
            Effect.timeoutOrElse({
              duration: timeout,
              orElse: () => Effect.fail(timeoutError(operation)),
            }),
            Effect.onInterrupt(() =>
              send(Request.cases.Cancel.make({ id, session })),
            ),
            Effect.ensuring(
              Effect.sync(() => MutableHashMap.remove(pending, id)),
            ),
          )
        })

      const receive = (response: Response): Effect.Effect<void> =>
        Option.match(responseId(response), {
          onNone: () =>
            response._tag === 'Changed'
              ? Effect.asVoid(PubSub.publish(changes, response.changes))
              : Effect.void,
          onSome: id =>
            Option.match(MutableHashMap.get(pending, id), {
              onNone: () => Effect.void,
              onSome: deferred =>
                Effect.asVoid(Deferred.succeed(deferred, response)),
            }),
        })

      const useSender = (next: Sender, reason: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* Ref.set(sender, next)
          const waiting = globalThis.Array.from(MutableHashMap.values(pending))
          MutableHashMap.clear(pending)
          yield* Effect.forEach(
            waiting,
            deferred =>
              Deferred.fail(deferred, connectionError(reason, 'leader')),
            { discard: true },
          )
        })

      return { session, call, receive, useSender, changes }
    }),
)
