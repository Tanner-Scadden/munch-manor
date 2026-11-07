import { Array, Function, Option, Schema, String, pipe } from 'effect'

// NOTE: the pure rules of linking a second device. Device A asks for a code
// and shows it; device B types it within CODE_TTL_MS and is mapped to A's
// player. The alphabet has 32 symbols with no 0, O, 1, or I, so a byte maps
// to one symbol without bias and a code reads aloud cleanly. Six symbols is
// about a billion codes; with at most MAX_FAILED_ATTEMPTS wrong tries per
// device per window, plus a per-address rate limit at the edge, guessing a
// live code is not practical.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6
export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_FAILED_ATTEMPTS = 5
export const ATTEMPT_WINDOW_MS = 10 * 60 * 1000

export const LinkCode = Schema.String.check(
  Schema.isPattern(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/),
)
export type LinkCode = typeof LinkCode.Type

const isLinkCode = Schema.is(LinkCode)

export const codeFromBytes = (bytes: Uint8Array): string =>
  pipe(
    Array.fromIterable(bytes),
    Array.take(CODE_LENGTH),
    Array.map(byte =>
      Option.getOrElse(String.charAt(CODE_ALPHABET, byte & 31), () => ''),
    ),
    Array.join(''),
  )

// NOTE: what a player types: any case, with spaces or a dash between the
// halves. Anything else is not a code.
export const normalizeCode = (input: string): Option.Option<LinkCode> => {
  const cleaned = pipe(
    input,
    String.toUpperCase,
    String.replaceAll(/[\s-]/g, ''),
  )
  return isLinkCode(cleaned) ? Option.some(cleaned) : Option.none()
}

export const isExpired: {
  (nowMs: number): (expiresMs: number) => boolean
  (expiresMs: number, nowMs: number): boolean
} = Function.dual(
  2,
  (expiresMs: number, nowMs: number): boolean => nowMs >= expiresMs,
)

// ATTEMPTS

export const Attempts = Schema.Struct({
  windowStartMs: Schema.Finite,
  failures: Schema.Finite,
})
export type Attempts = typeof Attempts.Type

export const AttemptDecision = Schema.TaggedUnion({
  Allowed: {},
  Limited: { retryAfterMs: Schema.Finite },
})
export type AttemptDecision = typeof AttemptDecision.Type

const inWindow = (attempts: Attempts, nowMs: number): boolean =>
  nowMs - attempts.windowStartMs < ATTEMPT_WINDOW_MS

export const decideAttempt: {
  (nowMs: number): (maybeAttempts: Option.Option<Attempts>) => AttemptDecision
  (maybeAttempts: Option.Option<Attempts>, nowMs: number): AttemptDecision
} = Function.dual(
  2,
  (maybeAttempts: Option.Option<Attempts>, nowMs: number): AttemptDecision =>
    Option.match(maybeAttempts, {
      onNone: () => AttemptDecision.cases.Allowed.make({}),
      onSome: attempts =>
        inWindow(attempts, nowMs) && attempts.failures >= MAX_FAILED_ATTEMPTS
          ? AttemptDecision.cases.Limited.make({
              retryAfterMs: attempts.windowStartMs + ATTEMPT_WINDOW_MS - nowMs,
            })
          : AttemptDecision.cases.Allowed.make({}),
    }),
)

export const afterFailure: {
  (nowMs: number): (maybeAttempts: Option.Option<Attempts>) => Attempts
  (maybeAttempts: Option.Option<Attempts>, nowMs: number): Attempts
} = Function.dual(
  2,
  (maybeAttempts: Option.Option<Attempts>, nowMs: number): Attempts =>
    Option.match(
      Option.filter(maybeAttempts, attempts => inWindow(attempts, nowMs)),
      {
        onNone: () => ({ windowStartMs: nowMs, failures: 1 }),
        onSome: attempts => ({
          windowStartMs: attempts.windowStartMs,
          failures: attempts.failures + 1,
        }),
      },
    ),
)
