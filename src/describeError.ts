import { Schema } from 'effect'

// NOTE: a thrown value as the reason a tagged error carries: an Error's
// message, or anything else as text.
export const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// NOTE: a browser API that threw or rejected (the DOM, full screen, the
// clipboard, share, fonts), for the effects that touch one and then fall
// back or ignore the failure.
export class BrowserError extends Schema.TaggedError<
  BrowserError,
  { readonly brand: unique symbol }
>()('BrowserError', {
  reason: Schema.String,
}) {}

export const toBrowserError = (error: unknown): BrowserError =>
  BrowserError.make({ reason: describeError(error) })
