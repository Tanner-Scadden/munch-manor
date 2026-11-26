import { Schema } from 'effect'

export const DayStamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
)
export type DayStamp = typeof DayStamp.Type
