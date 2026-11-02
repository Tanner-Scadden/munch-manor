import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'

import type {
  D1Database,
  ExecutionContext,
  RateLimit,
  ScheduledController,
} from '@cloudflare/workers-types'
import * as D1Client from '@effect/sql-d1/D1Client'

import {
  WorkerEnv,
  type WorkerServices,
  deleteExpiredRuns,
  makeHandler,
} from './api.ts'
import { routeRoom } from './roomRoutes.ts'
import { type SyncBindings, routeSync } from './sync.ts'

export { GameRoom } from './gameRoom.ts'
export { Matchmaker } from './matchmaker.ts'
export { SyncDirectory, SyncScope } from './sync.ts'

export type Bindings = SyncBindings &
  Readonly<{
    DB: D1Database
    RUNS_BY_VISIT: RateLimit
    RUNS_BY_ADDRESS: RateLimit
    ADDRESS_SALT: string
  }>

const servicesOf = (env: Bindings): WorkerServices => ({
  database: D1Client.layer({ db: env.DB }),
  visitLimiter: env.RUNS_BY_VISIT,
  addressLimiter: env.RUNS_BY_ADDRESS,
  addressSalt: env.ADDRESS_SALT,
})

// NOTE: the router is built once per isolate, outside any request, so a
// request only pays for its own work against the 10 ms CPU limit of the free
// plan. Each request gets its bindings through WorkerEnv. The /sync paths
// (sync.ts) go to the sync Durable Objects; everything else is analytics.
const { handler } = makeHandler()

// NOTE: the daily retention cleanup, fired by the Cron Trigger declared in
// alchemy.run.ts. It deletes run rows older than 90 days, as of the time the
// trigger was scheduled for.
const cleanUp = (env: Bindings, scheduledMs: number) =>
  deleteExpiredRuns(scheduledMs).pipe(
    Effect.tap(deleted => Effect.log(`Deleted ${deleted} expired run rows`)),
    Effect.provide(D1Client.layer({ db: env.DB })),
  )

// NOTE: the edge. Each request runs one Effect: routeSync answers the /sync
// paths, routeRoom the /room paths (co-op rooms), each with every failure
// on them, and anything else goes to the analytics handler.
const respond = (request: Request, env: Bindings) =>
  Effect.flatMap(
    Effect.filterOrElse(routeSync(request, env), Option.isSome, () =>
      routeRoom(request, env),
    ),
    Option.match({
      onSome: Effect.succeed,
      onNone: () =>
        Effect.promise(() =>
          handler(request, Context.make(WorkerEnv, servicesOf(env))),
        ),
    }),
  )

export default {
  fetch: (request: Request, env: Bindings): Promise<Response> =>
    Effect.runPromise(respond(request, env)),
  scheduled: (
    controller: ScheduledController,
    env: Bindings,
    context: ExecutionContext,
  ): void => {
    context.waitUntil(Effect.runPromise(cleanUp(env, controller.scheduledTime)))
  },
}
