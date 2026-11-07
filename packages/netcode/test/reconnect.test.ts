import { Array, Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'

import { describe, expect, it } from '@effect/vitest'

import { type Ended, backoffUpTo, reconnecting } from '../src/Reconnect'

// NOTE: a connection that ends as scripted, recording each attempt number
// and the clock when it started, on it.effect's TestClock.
const play = (script: ReadonlyArray<Ended>) =>
  Effect.gen(function* () {
    const tries = yield* Ref.make<ReadonlyArray<readonly [number, number]>>([])
    const fiber = yield* Effect.forkChild(
      reconnecting(
        attempt =>
          Effect.gen(function* () {
            const done = yield* Ref.get(tries)
            const atMs = yield* Effect.clockWith(clock =>
              Effect.succeed(clock.currentTimeMillisUnsafe()),
            )
            yield* Ref.set(tries, [...done, [attempt, atMs]])
            return script[done.length] ?? 'Stopped'
          }),
        backoffUpTo(5000),
      ),
    )
    yield* TestClock.adjust('60 seconds')
    yield* Fiber.join(fiber)
    return yield* Ref.get(tries)
  })

describe('reconnecting', () => {
  it.effect('backs off while no try is heard, and stops when told', () =>
    Effect.gen(function* () {
      const tries = yield* play(['Unheard', 'Unheard', 'Unheard', 'Stopped'])
      expect(Array.map(tries, ([attempt]) => attempt)).toEqual([0, 1, 2, 3])
      const gaps = Array.map(
        tries.slice(1),
        ([, atMs], index) => atMs - (tries[index]?.[1] ?? 0),
      )
      expect(gaps[1]!).toBeGreaterThan(gaps[0]!)
      expect(gaps[2]!).toBeGreaterThan(gaps[1]!)
    }),
  )

  it.effect('a heard connection starts the attempts and the backoff over', () =>
    Effect.gen(function* () {
      const tries = yield* play([
        'Unheard',
        'Unheard',
        'Unheard',
        'Heard',
        'Unheard',
        'Stopped',
      ])
      expect(Array.map(tries, ([attempt]) => attempt)).toEqual([
        0, 1, 2, 3, 0, 1,
      ])
      const gapAt = (index: number) =>
        (tries[index]?.[1] ?? 0) - (tries[index - 1]?.[1] ?? 0)
      expect(gapAt(4)).toBeLessThan(gapAt(3))
      expect(gapAt(5)).toBeLessThan(gapAt(3))
    }),
  )
})
