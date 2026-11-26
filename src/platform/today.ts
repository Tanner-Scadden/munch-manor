import { DateTime, Duration, Effect, Stream } from 'effect'

import type { DayStamp } from '#shared/dayStamp.ts'

const TODAY_CHECK_INTERVAL = Duration.minutes(1)

const dayOf = (dateTime: DateTime.DateTime): DayStamp =>
  DateTime.formatIsoDateUtc(dateTime)

export const todays: Stream.Stream<DayStamp> = Stream.tick(
  TODAY_CHECK_INTERVAL,
).pipe(
  Stream.mapEffect(() => Effect.map(DateTime.now, dayOf)),
  Stream.changes,
)
