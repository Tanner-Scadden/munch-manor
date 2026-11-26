import { Effect, Function, Option, Stream } from 'effect'
import { TestClock } from 'effect/testing'

const STEP = '10 millis'
const TURNS_PER_STEP = 20
const LIMIT = '30 seconds'

const driveClock: Effect.Effect<never> = Effect.forever(
  Effect.andThen(
    Effect.repeat(Effect.yieldNow, { times: TURNS_PER_STEP - 1 }),
    TestClock.adjust(STEP),
  ),
)

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
