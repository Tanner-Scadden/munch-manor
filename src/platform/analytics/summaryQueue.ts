import { Effect, Function, Option, Schedule, Schema, pipe } from 'effect'
import type { Duration } from 'effect'

import { API_ORIGIN } from '#platform/apiOrigin.ts'
import { PlayerStore } from '#platform/save/store.ts'
import { isObjectFirst } from '#shared/dualArgs.ts'

import { PostedRunJson, type RunSummary, RunSummaryJson } from './analytics.ts'
import { sendRunSummary } from './analyticsBeacon.ts'

const QUEUE_SPACING: Duration.Input = '11 seconds'

export const isOnline: Effect.Effect<boolean> = Effect.sync(
  () => navigator.onLine,
)

const queueRunSummary = (summary: RunSummary) =>
  pipe(
    Schema.encodeEffect(RunSummaryJson)(summary),
    Effect.mapError(error => ({ reason: error.message })),
    Effect.flatMap(body => PlayerStore.use(store => store.queueSummary(body))),
  )

const sendNextQueued = (origin: string) =>
  pipe(
    isOnline,
    Effect.flatMap(online =>
      online
        ? PlayerStore.use(store => store.takeQueuedSummary)
        : Effect.succeedNone,
    ),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(false),
        onSome: body =>
          pipe(
            Schema.decodeEffect(PostedRunJson)(body),
            Effect.matchEffect({
              onFailure: () => Effect.succeed(true),
              onSuccess: summary =>
                pipe(
                  sendRunSummary(summary, origin),
                  Effect.as(true),
                  Effect.catch(() =>
                    Effect.as(
                      PlayerStore.use(store => store.queueSummary(body)),
                      false,
                    ),
                  ),
                ),
            }),
          ),
      }),
    ),
  )

const drainSummaryQueue = (origin: string) =>
  pipe(
    sendNextQueued(origin),
    Effect.repeat({
      while: isSent => isSent,
      schedule: Schedule.spaced(QUEUE_SPACING),
    }),
    Effect.asVoid,
    Effect.catch(error =>
      Effect.logWarning('The summary queue could not be drained', error.reason),
    ),
  )

type SendFailure = Readonly<{ reason: string }>

export const sendOrQueueRunSummary: {
  (
    origin?: string,
  ): (summary: RunSummary) => Effect.Effect<void, SendFailure, PlayerStore>
  (
    summary: RunSummary,
    origin?: string,
  ): Effect.Effect<void, SendFailure, PlayerStore>
} = Function.dual(
  isObjectFirst,
  (
    summary: RunSummary,
    origin: string = API_ORIGIN,
  ): Effect.Effect<void, SendFailure, PlayerStore> =>
    Effect.flatMap(isOnline, online =>
      online || origin === ''
        ? pipe(
            sendRunSummary(summary, origin),
            Effect.tap(() => Effect.forkDetach(drainSummaryQueue(origin))),
            Effect.asVoid,
          )
        : queueRunSummary(summary),
    ),
)

export const startSummaryQueue = (origin: string = API_ORIGIN) =>
  pipe(
    PlayerStore.use(store => store.load),
    Effect.flatMap(maybeSave =>
      Option.exists(maybeSave, save => save.settings.shareStats === 'Off')
        ? PlayerStore.use(store => store.clearQueuedSummaries)
        : drainSummaryQueue(origin),
    ),
    Effect.catch(error =>
      Effect.logWarning('The summary queue could not start', error.reason),
    ),
  )
