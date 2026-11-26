import * as Alchemy from 'alchemy'
import * as Effect from 'effect/Effect'
import * as Path from 'effect/Path'
import { createRequire } from 'node:module'

import * as Cloudflare from '@alchemy.run/cloudflare'

const infraEffect = Effect.map(Path.Path, path =>
  path.join(
    path.dirname(createRequire(import.meta.url).resolve('effect/package.json')),
    'dist',
  ),
)

export default Alchemy.Stack(
  'munch-eventlog-spike',
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage
    const path = yield* Path.Path
    const effectAlias = yield* infraEffect
    const worker = yield* Cloudflare.Worker('EventLogSpike', {
      name: `munch-eventlog-spike-${stage}`,
      main: path.resolve(import.meta.dirname, 'worker.ts'),
      observability: { enabled: true, logs: { enabled: true, invocationLogs: true } },
      env: { EVENTLOG: Cloudflare.DurableObject('EventLogStore') },
      build: { input: { resolve: { alias: { effect: effectAlias } } } },
    })
    return { url: worker.url }
  }),
)
