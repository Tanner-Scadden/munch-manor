import { DateTime, Duration, Effect, Stream } from 'effect'

import type { DayStamp } from '../shared/dayStamp'

// Today's day in UTC, as YYYY-MM-DD: read when the game starts and checked
// each minute after, said only when it changes. The Today Subscription
// (src/app/subscriptions.ts) turns it into ChangedToday, and the Model keeps
// it (`maybeToday`) for whatever pays once a day.

const TODAY_CHECK_INTERVAL = Duration.minutes(1)

// NOTE: the day of a moment, in UTC, so every device agrees when a day
// starts whatever its time zone.
const dayOf = (dateTime: DateTime.DateTime): DayStamp =>
  DateTime.formatIsoDateUtc(dateTime)

export const todays: Stream.Stream<DayStamp> = Stream.tick(
  TODAY_CHECK_INTERVAL,
).pipe(
  Stream.mapEffect(() => Effect.map(DateTime.now, dayOf)),
  Stream.changes,
)
