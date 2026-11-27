import { Array } from 'effect'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'

import type {
  D1Database,
  ExecutionContext,
  R2Bucket,
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
import { linkStoreOf, routeLink } from './linkCodes.ts'
import { routePlayerLog } from './playerLog.ts'
import { routeRecording } from './recordings.ts'
import { routeRoom } from './roomRoutes.ts'
import { type SyncBindings, routeSync } from './sync.ts'

export { GameRoom } from './gameRoom.ts'
export { Matchmaker } from './matchmaker.ts'
export { LinkCodes } from './linkCodes.ts'
export { PlayerLog } from './playerLog.ts'

export type Bindings = SyncBindings &
  Readonly<{
    DB: D1Database
    RUNS_BY_VISIT: RateLimit
    RUNS_BY_ADDRESS: RateLimit
    ADDRESS_SALT: string
    RECORDINGS: R2Bucket
    RECORDINGS_BY_PLAYER: RateLimit
  }>

const servicesOf = (env: Bindings): WorkerServices => ({
  database: D1Client.layer({ db: env.DB }),
  visitLimiter: env.RUNS_BY_VISIT,
  addressLimiter: env.RUNS_BY_ADDRESS,
  addressSalt: env.ADDRESS_SALT,
})

const { handler } = makeHandler()

const cleanUp = (env: Bindings, scheduledMs: number) =>
  Effect.scoped(
    Effect.gen(function* () {
      const database = yield* Layer.build(D1Client.layer({ db: env.DB }))
      const deleted = yield* Effect.provideContext(
        deleteExpiredRuns(scheduledMs),
        database,
      )
      yield* Effect.log(`Deleted ${deleted} expired run rows`)
    }),
  )

const ROUTES: ReadonlyArray<
  (request: Request, env: Bindings) => Effect.Effect<Option.Option<Response>>
> = [
  (request, env) => routePlayerLog(request, env),
  (request, env) =>
    routeLink(request, {
      limiter: env.SYNC_BY_ADDRESS,
      store: linkStoreOf(env.LINK_CODES),
    }),
  (request, env) => routeSync(request, env),
  (request, env) => routeRoom(request, env),
  (request, env) => routeRecording(request, env),
]

const NOT_ROUTED: Effect.Effect<Option.Option<Response>> = Effect.succeedNone

const routed = (request: Request, env: Bindings) =>
  Array.reduce(ROUTES, NOT_ROUTED, (prior, route) =>
    Effect.filterOrElse(prior, Option.isSome, () => route(request, env)),
  )

const respond = (request: Request, env: Bindings) =>
  Effect.flatMap(
    routed(request, env),
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
