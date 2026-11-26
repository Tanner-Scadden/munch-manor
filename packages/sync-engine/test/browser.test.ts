import { Effect, Exit, Option, Stream } from 'effect'
import { FetchHttpClient } from 'effect/http'

import { describe, expect, it } from '@effect/vitest'

import { httpTransport } from '../src/Browser'
import { decodeExchange } from '../src/Protocol'

const ORIGIN = 'https://sync.example.test'

interface Seen {
  readonly url: string
  readonly method: string | undefined
  readonly headers: Headers
  readonly body: string
}

const fakeFetch = (responses: ReadonlyArray<() => Response>) => {
  const seen: Array<Seen> = []
  const fetch: typeof globalThis.fetch = (input, init) =>
    (init?.body === undefined || init.body === null
      ? Promise.resolve('')
      : new Response(init.body).text()
    ).then(body => {
      seen.push({
        url:
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        method: init?.method,
        headers: new Headers(init?.headers),
        body,
      })
      const next = responses[seen.length - 1]
      return next === undefined ? new Response(null, { status: 500 }) : next()
    })
  return { seen, fetch }
}

const exitWith = <A, E>(
  fetch: typeof globalThis.fetch,
  effect: Effect.Effect<A, E>,
) => Effect.exit(Effect.provideService(effect, FetchHttpClient.Fetch, fetch))

describe('the HTTP transport', () => {
  const hello = {
    _tag: 'Hello' as const,
    protocol: 1,
    scope: 'notes:ada',
    lastSeq: 0,
    mode: 'Catchup' as const,
    clientId: 'client-1',
    token: 'token-1',
    versions: {},
  }

  it.effect('an exchange posts the Hello and feeds the replies back', () =>
    Effect.gen(function* () {
      const { seen, fetch } = fakeFetch([
        () => Response.json([{ _tag: 'Pong' }]),
      ])
      const exit = yield* exitWith(
        fetch,
        Effect.scoped(
          Effect.gen(function* () {
            const channel = yield* httpTransport(ORIGIN).open('notes:ada')
            yield* channel.send(hello)
            return yield* Stream.runHead(channel.messages)
          }),
        ),
      )
      expect(Exit.isSuccess(exit)).toBe(true)
      expect(seen[0]?.url).toBe(`${ORIGIN}/sync/exchange?scope=notes%3Aada`)
      const value_3 = yield* decodeExchange(seen[0]?.body ?? '')
      expect(value_3).toEqual([hello])
      expect(seen[0]?.headers.has('traceparent')).toBe(false)
    }),
  )

  it.effect('a failed exchange fails the channel with the status', () =>
    Effect.gen(function* () {
      const { fetch } = fakeFetch([() => new Response('', { status: 503 })])
      const exit = yield* exitWith(
        fetch,
        Effect.scoped(
          Effect.gen(function* () {
            const channel = yield* httpTransport(ORIGIN).open('notes:ada')
            return yield* channel.send(hello)
          }),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(
        Option.map(Exit.findErrorOption(exit), error => error.reason),
      ).toEqual(Option.some('HTTP 503'))
    }),
  )
})
