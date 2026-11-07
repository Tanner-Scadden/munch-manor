import { Effect, Function, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'

// TESTING

// NOTE: for tests that run sync on the TestClock `it.effect` provides, where
// the heartbeat, the silence watchdog, the resend timer, the backoff, and the
// follower poll move only when the test moves time. A loaded machine then
// cannot make a server look quiet and drop a session halfway through a test.

const STEP = '10 millis'
const TURNS_PER_STEP = 20
const LIMIT = '30 seconds'

// NOTE: hands the other fibers turns and moves the TestClock a step, so a
// backoff or a poll in the way of a wait still elapses. It never ends: settle
// interrupts it once the wait is over.
const driveClock: Effect.Effect<never> = Effect.forever(
  Effect.andThen(
    Effect.repeat(Effect.yieldNow, { times: TURNS_PER_STEP - 1 }),
    TestClock.adjust(STEP),
  ),
)

// NOTE: waits for an event, not for time, while driveClock runs beside it.
// The limit is on the TestClock too, so a wait that never ends fails after 30
// seconds of test clock, not of real time.
export const settle = <A, E, R>(
  wait: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.raceFirst(
    Effect.timeoutOrElse(wait, {
      duration: LIMIT,
      orElse: () =>
        Effect.die(new Error('Still waiting after 30 s of test clock')),
    }),
    driveClock,
  )

// NOTE: the first value a stream shows that passes, waited for with settle.
// The status streams start with the current value, so nothing is missed.
export const first: {
  <A, E, R>(
    isDone: (value: A) => boolean,
  ): (stream: Stream.Stream<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(
    stream: Stream.Stream<A, E, R>,
    isDone: (value: A) => boolean,
  ): Effect.Effect<A, E, R>
} = Function.dual(
  2,
  <A, E, R>(
    stream: Stream.Stream<A, E, R>,
    isDone: (value: A) => boolean,
  ): Effect.Effect<A, E, R> =>
    settle(
      Effect.flatMap(Stream.runHead(Stream.filter(stream, isDone)), maybe =>
        Option.match(maybe, {
          onNone: () => Effect.die(new Error('The stream ended')),
          onSome: Effect.succeed,
        }),
      ),
    ),
)
