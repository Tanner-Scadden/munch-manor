import { Duration, Effect, Function, Ref, Schedule, pipe } from 'effect'

export type Ended = 'Stopped' | 'Heard' | 'Unheard'

const FIRST_BACKOFF_MS = 250

export const backoffUpTo = (maxMs: number): Schedule.Schedule<unknown> =>
  Schedule.jittered(
    Schedule.min([
      Schedule.exponential(Duration.millis(FIRST_BACKOFF_MS)),
      Schedule.spaced(Duration.millis(maxMs)),
    ]),
  )

const AFTER_HEARD: Schedule.Schedule<unknown> = Schedule.jittered(
  Schedule.spaced(Duration.millis(FIRST_BACKOFF_MS)),
)

export const reconnecting: {
  (
    backoff: Schedule.Schedule<unknown>,
  ): (connect: (attempt: number) => Effect.Effect<Ended>) => Effect.Effect<void>
  (
    connect: (attempt: number) => Effect.Effect<Ended>,
    backoff: Schedule.Schedule<unknown>,
  ): Effect.Effect<void>
} = Function.dual(
  2,
  (
    connect: (attempt: number) => Effect.Effect<Ended>,
    backoff: Schedule.Schedule<unknown>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const once = Effect.gen(function* () {
        const value = yield* Ref.getAndUpdate(attempts, n => n + 1)
        const ended = yield* connect(value)
        if (ended === 'Stopped') {
          return
        }
        if (ended === 'Heard') {
          yield* Ref.set(attempts, 0)
        }
        return yield* Effect.fail(ended)
      })
      yield* pipe(
        once,
        Effect.retry({
          schedule: backoff,
          while: (ended: Ended) => ended === 'Unheard',
        }),
        Effect.retry({
          schedule: AFTER_HEARD,
          while: (ended: Ended) => ended === 'Heard',
        }),
        Effect.ignore,
      )
    }),
)
