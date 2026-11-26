import { Function, Schema } from 'effect'

export const DayStamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
)
export type DayStamp = typeof DayStamp.Type

export const laterDay: {
  (b: DayStamp | null): (a: DayStamp | null) => DayStamp | null
  (a: DayStamp | null, b: DayStamp | null): DayStamp | null
} = Function.dual(
  2,
  (a: DayStamp | null, b: DayStamp | null): DayStamp | null =>
    a === null ? b : b === null ? a : a >= b ? a : b,
)
