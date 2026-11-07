// Serves the co-op dev page locally, pointed at any API origin: a local
// workerd (see e2e.ts) or a preview's API Worker.
//   bun tools/mp-dev/serve.ts https://munch-manor-api-pr-12.tanner-scadden.workers.dev [port]
// then open http://localhost:4180/ in two to four tabs.
import { Console, Effect, Path, String } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { buildPage } from './build'

const here = import.meta.dirname

// NOTE: the page is served for as long as the scope lasts.
const servePage = (apiOrigin: string, port: number) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    yield* buildPage(apiOrigin)
    const pageDir = path.resolve(here, 'dist/page')
    return yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port,
          hostname: '127.0.0.1',
          fetch: request => {
            const route = new URL(request.url).pathname
            const name = route === '/' ? 'index.html' : String.slice(1)(route)
            if (name !== 'index.html' && name !== 'main.js') {
              return new Response('Not found', { status: 404 })
            }
            return new Response(Bun.file(path.resolve(pageDir, name)), {
              headers: {
                'content-type': String.endsWith('.js')(name)
                  ? 'text/javascript'
                  : 'text/html; charset=utf-8',
                'cache-control': 'no-store',
              },
            })
          },
        }),
      ),
      server => Effect.sync(() => server.stop()),
    )
  })

const apiOrigin = process.argv[2] ?? ''
const port = Number(process.argv[3] ?? 4180)

NodeRuntime.runMain(
  Effect.scoped(
    Effect.gen(function* () {
      yield* servePage(apiOrigin, port)
      yield* Console.log(
        `The co-op dev page is at http://localhost:${port}/ (API ${apiOrigin || 'same origin'})`,
      )
      return yield* Effect.never
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
)
