import { Duration, Effect, Function, Ref, Schedule, pipe } from 'effect'

// NOTE: how a socket's connection ended. `Stopped` stops reconnecting (a
// final refusal, a kick, a leave). `Heard` dropped after the server spoke,
// so the next try comes soon and the backoff starts over; `Unheard` never
// got that far, so the tries back off.
export type Ended = 'Stopped' | 'Heard' | 'Unheard'

const FIRST_BACKOFF_MS = 250

// NOTE: a quarter second, doubling, never more than `maxMs` apart, with
// jitter so a room's players do not all reconnect in step after an outage.
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

// NOTE: runs `connect` again and again, with its attempt number, until it
// ends `Stopped`. Tries that never heard the server wait by `backoff`; a
// connection that did resets the attempts and the backoff, so one dropped
// socket in a long session does not wait as if every try had failed.
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
