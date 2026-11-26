import {
  Array,
  Duration,
  Effect,
  Option,
  Queue,
  Ref,
  Result,
  Schema,
  type Scope,
  pipe,
} from 'effect'

import type { Engine, EngineOpenError, OpenOptions } from './Engine'
import { type Execute, type Open, Request, Response } from './Protocol'

export interface Server {
  readonly offer: (request: Request) => Effect.Effect<void>
}

export interface ServerOptions {
  readonly open: (
    options: OpenOptions,
  ) => Effect.Effect<Engine, EngineOpenError>
  readonly respond: (response: Response) => Effect.Effect<void>
  readonly transactionIdleTimeout?: Duration.Input | undefined
}

const DEFAULT_TRANSACTION_IDLE_TIMEOUT: Duration.Input = '10 seconds'

const Owner = Schema.Struct({
  session: Schema.String,
  epoch: Schema.Finite,
})
type Owner = typeof Owner.Type

interface State {
  readonly maybeEngine: Option.Option<Engine>
  readonly waiting: ReadonlyArray<Execute>
  readonly owner: Option.Option<Owner>
  readonly epoch: number
}

const Inbound = Schema.TaggedUnion({
  Arrived: { request: Request },
  IdledOut: { owner: Owner },
})
type Inbound = typeof Inbound.Type

const NOT_OPEN = {
  code: 'SQLITE_MISUSE',
  message: 'The database is not open yet',
}

const isOwnedBy = (owner: Option.Option<Owner>, session: string): boolean =>
  Option.match(owner, {
    onNone: () => true,
    onSome: current => current.session === session,
  })

export const makeServer = (
  options: ServerOptions,
): Effect.Effect<Server, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope
    const inbox = yield* Queue.unbounded<Inbound>()
    const state = yield* Ref.make<State>({
      maybeEngine: Option.none(),
      waiting: [],
      owner: Option.none(),
      epoch: 0,
    })
    const idleTimeout = Duration.fromInputUnsafe(
      options.transactionIdleTimeout ?? DEFAULT_TRANSACTION_IDLE_TIMEOUT,
    )

    const watchIdle = (owner: Owner): Effect.Effect<void> =>
      pipe(
        Effect.sleep(idleTimeout),
        Effect.andThen(
          Queue.offer(inbox, Inbound.cases.IdledOut.make({ owner })),
        ),
        Effect.asVoid,
        Effect.forkIn(scope),
        Effect.asVoid,
      )

    const reportChanges = (engine: Engine): Effect.Effect<void> =>
      Array.match(engine.takeChanges(), {
        onEmpty: () => Effect.void,
        onNonEmpty: changes =>
          options.respond(Response.cases.Changed.make({ changes })),
      })

    const run = (engine: Engine, request: Execute): Effect.Effect<void> =>
      Effect.gen(function* () {
        const result = engine.execute(request.sql, request.params)
        yield* options.respond(
          Result.match(result, {
            onSuccess: rows =>
              Response.cases.Rows.make({
                id: request.id,
                columns: rows.columns,
                values: rows.values,
              }),
            onFailure: failure =>
              Response.cases.Failed.make({ id: request.id, failure }),
          }),
        )
        const current = yield* Ref.get(state)
        const epoch = current.epoch + 1
        const owner = engine.isInTransaction()
          ? Option.some({ session: request.session, epoch })
          : Option.none()
        yield* Ref.set(state, { ...current, owner, epoch })
        yield* Option.match(owner, {
          onNone: () => Effect.void,
          onSome: watchIdle,
        })
        yield* reportChanges(engine)
      })

    const drain: Effect.Effect<void> = Effect.gen(function* () {
      const current = yield* Ref.get(state)
      const maybeNext = Array.findFirstIndex(current.waiting, request =>
        isOwnedBy(current.owner, request.session),
      )
      if (Option.isNone(maybeNext) || Option.isNone(current.maybeEngine)) {
        return
      }
      const index = maybeNext.value
      const request = current.waiting[index]
      if (request === undefined) {
        return
      }
      yield* Ref.set(state, {
        ...current,
        waiting: Array.remove(current.waiting, index),
      })
      yield* run(current.maybeEngine.value, request)
      yield* drain
    })

    const execute = (request: Execute): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (Option.isNone(current.maybeEngine)) {
          return yield* options.respond(
            Response.cases.Failed.make({ id: request.id, failure: NOT_OPEN }),
          )
        }
        if (!isOwnedBy(current.owner, request.session)) {
          return yield* Ref.set(state, {
            ...current,
            waiting: Array.append(current.waiting, request),
          })
        }
        yield* run(current.maybeEngine.value, request)
        yield* drain
      })

    const open = (request: Open): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        if (Option.isSome(current.maybeEngine)) {
          return yield* options.respond(
            Response.cases.Opened.make({
              id: request.id,
              persistence: current.maybeEngine.value.persistence,
            }),
          )
        }
        yield* pipe(
          options.open({ file: request.file, directory: request.directory }),
          Effect.matchEffect({
            onFailure: error =>
              options.respond(
                Response.cases.OpenFailed.make({
                  id: request.id,
                  failure: error.failure,
                }),
              ),
            onSuccess: engine =>
              Effect.andThen(
                Ref.update(state, next => ({
                  ...next,
                  maybeEngine: Option.some(engine),
                })),
                options.respond(
                  Response.cases.Opened.make({
                    id: request.id,
                    persistence: engine.persistence,
                  }),
                ),
              ),
          }),
        )
        yield* drain
      })

    const endSession = (session: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const isOwner = Option.exists(
          current.owner,
          owner => owner.session === session,
        )
        if (isOwner && Option.isSome(current.maybeEngine)) {
          current.maybeEngine.value.rollback()
        }
        yield* Ref.set(state, {
          ...current,
          waiting: Array.filter(
            current.waiting,
            request => request.session !== session,
          ),
          owner: isOwner ? Option.none() : current.owner,
        })
        yield* drain
      })

    const idledOut = (owner: Owner): Effect.Effect<void> =>
      Effect.gen(function* () {
        const current = yield* Ref.get(state)
        const isStillIdle = Option.exists(
          current.owner,
          now => now.session === owner.session && now.epoch === owner.epoch,
        )
        if (isStillIdle) {
          yield* endSession(owner.session)
        }
      })

    const cancel = (id: string, session: string): Effect.Effect<void> =>
      Ref.update(state, current => ({
        ...current,
        waiting: Array.filter(
          current.waiting,
          request => request.id !== id || request.session !== session,
        ),
      }))

    const handle = (inbound: Inbound): Effect.Effect<void> =>
      Inbound.match(inbound, {
        Arrived: ({ request }) =>
          Request.match(request, {
            Open: open,
            Execute: execute,
            Cancel: ({ id, session }) => cancel(id, session),
            Release: ({ session }) => endSession(session),
          }),
        IdledOut: ({ owner }) => idledOut(owner),
      })

    yield* pipe(
      Queue.take(inbox),
      Effect.flatMap(handle),
      Effect.forever,
      Effect.forkIn(scope),
    )

    return {
      offer: request =>
        Effect.asVoid(
          Queue.offer(inbox, Inbound.cases.Arrived.make({ request })),
        ),
    }
  })
