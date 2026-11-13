import { Schema } from 'effect'

// NOTE: a UTC day as YYYY-MM-DD, as the Model's `maybeToday` holds it
// (src/platform/today.ts). Days of this shape sort as strings. Apart from
// src/shared/playerData.ts so the daily missions' data
// (src/shared/missionData.ts), which the save holds, can read it too.
export const DayStamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
)
export type DayStamp = typeof DayStamp.Type
