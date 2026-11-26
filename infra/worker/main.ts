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
import { routeRecording } from './recordings.ts'
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

const respond = (request: Request, env: Bindings) =>
  Effect.flatMap(
    Effect.filterOrElse(
      Effect.filterOrElse(routeSync(request, env), Option.isSome, () =>
        routeRoom(request, env),
      ),
      Option.isSome,
      () => routeRecording(request, env),
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
