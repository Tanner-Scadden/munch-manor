import { Effect, Option, Schedule, Schema, pipe } from 'effect'
import type { Duration } from 'effect'

import { type RunSummary, RunSummaryJson } from './analytics'
import { sendRunSummary } from './analyticsBeacon'
import { API_ORIGIN } from './apiOrigin'
import { PlayerStore } from './store'

// NOTE: a run that ends with no network cannot reach the analytics Worker, so
// its summary waits in the store (device local, never synced) and goes out
// when the game is next online: when it starts, and after the next run's
// summary is sent. The browser says it is offline with navigator.onLine,
// which is right when there is no network at all and says nothing about a
// bad one, so a summary sent on a bad network is still lost, as before.

// NOTE: the Worker allows 6 summaries a minute per visit id, and a queue can
// hold several runs of one visit, so they go out one at a time, this far
// apart.
const QUEUE_SPACING: Duration.Input = '11 seconds'

const isOnline: Effect.Effect<boolean> = Effect.sync(() => navigator.onLine)

const queueRunSummary = (summary: RunSummary) =>
  pipe(
    Schema.encodeEffect(RunSummaryJson)(summary),
    Effect.mapError(error => ({ reason: error.message })),
    Effect.flatMap(body => PlayerStore.use(store => store.queueSummary(body))),
  )

// NOTE: a queued summary is taken out of the store before it is sent, so two
// drains never send the same one. One that cannot be read any more (the
// summary's version moved on) is dropped, and one that fails to send goes
// back in the queue and stops the drain. Answers whether to send the next.
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
            Schema.decodeEffect(RunSummaryJson)(body),
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

// NOTE: a build with no API origin sends nothing, so it queues nothing.
// A summary sent while online also sends the ones that waited, in the
// background, so the run's own Message is not held up by the spacing.
export const sendOrQueueRunSummary = (
  summary: RunSummary,
  origin: string = API_ORIGIN,
) =>
  Effect.flatMap(isOnline, online =>
    online || origin === ''
      ? pipe(
          sendRunSummary(summary, origin),
          Effect.tap(() => Effect.forkDetach(drainSummaryQueue(origin))),
          Effect.asVoid,
        )
      : queueRunSummary(summary),
  )

// NOTE: at start, a player who has since turned sharing off loses what was
// queued instead of sending it.
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
