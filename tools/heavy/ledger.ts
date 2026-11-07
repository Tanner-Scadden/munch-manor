import { Effect, FileSystem, Function, Option, pipe } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import { type Ledger, decodeLedger, encodeLedger } from './decision'
import { readTextIfPresent } from './lock'

/** @stability unstable */
export const readLedger = (
  path: string,
): Effect.Effect<Ledger, never, FileSystem.FileSystem> =>
  pipe(
    readTextIfPresent(path),
    Effect.map(Option.match({ onNone: () => ({}), onSome: decodeLedger })),
    Effect.orElseSucceed(() => ({})),
  )

const writeLedger = (
  path: string,
  ledger: Ledger,
): Effect.Effect<void, PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const draft = `${path}.${process.pid}.draft`
    yield* fs.writeFileString(draft, encodeLedger(ledger))
    yield* fs.rename(draft, path)
  })

/** @stability unstable */
export const updateLedger: {
  (
    change: (ledger: Ledger) => Ledger,
  ): (
    path: string,
  ) => Effect.Effect<Ledger, PlatformError, FileSystem.FileSystem>
  (
    path: string,
    change: (ledger: Ledger) => Ledger,
  ): Effect.Effect<Ledger, PlatformError, FileSystem.FileSystem>
} = Function.dual(
  2,
  (
    path: string,
    change: (ledger: Ledger) => Ledger,
  ): Effect.Effect<Ledger, PlatformError, FileSystem.FileSystem> =>
    Effect.gen(function* () {
      const value = yield* readLedger(path)
      const next = change(value)
      yield* writeLedger(path, next)
      return next
    }),
)
