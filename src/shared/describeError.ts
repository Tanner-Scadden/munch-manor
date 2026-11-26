import { Schema } from 'effect'

export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class BrowserError extends Schema.TaggedError<
  BrowserError,
  { readonly brand: unique symbol }
>()('BrowserError', {
  reason: Schema.String,
}) {}

export const toBrowserError = (error: unknown): BrowserError =>
  BrowserError.make({ reason: describeError(error) })
