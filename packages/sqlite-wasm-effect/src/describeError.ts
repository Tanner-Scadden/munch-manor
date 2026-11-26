import { Predicate } from 'effect'

export const describeError = (error: unknown): string =>
  Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)
    ? error.message
    : String(error)
