import { Glob } from 'bun'
import {
  Array,
  Console,
  Effect,
  FileSystem,
  Option,
  Path,
  Runtime,
  Schema,
  String,
} from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

const README = 'README.md'

class TableDrifted extends Schema.TaggedError<
  TableDrifted,
  { readonly brand: unique symbol }
>()('TableDrifted', {
  count: Schema.Finite,
}) {
  override get [Runtime.errorExitCode](): number {
    return 1
  }
  override readonly [Runtime.errorReported] = false
}

const namedIn =
  (layer: string) =>
  (readme: string): ReadonlyArray<string> =>
    Array.flatMap(
      Array.filter(String.split('\n')(readme), line =>
        String.startsWith('| `')(line),
      ),
      (line: string) =>
        Array.map(
          Array.fromIterable(
            String.matchAll(/`([^`]+)`/g)(
              Option.getOrElse(Array.get(String.split('|')(line), 1), () => ''),
            ),
          ),
          ([, path]) => `${layer}/${path ?? ''}`,
        ),
    )

const isMapped = (file: string): boolean =>
  !String.includes('__tests__/')(file) && !String.endsWith('.d.ts')(file)

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = Option.getOrElse(Array.get(process.argv, 2), () =>
    path.resolve(import.meta.dirname, '../..'),
  )
  const readmes = Array.fromIterable(
    new Glob(`*/${README}`).scanSync({ cwd: path.join(root, 'src') }),
  )
  const tables = yield* Effect.forEach(readmes, readme =>
    Effect.map(fs.readFileString(path.join(root, 'src', readme)), text =>
      namedIn(path.dirname(readme))(text),
    ),
  )
  const named = new Set(Array.flatten(tables))

  const files = new Set(
    Array.filter(
      Array.fromIterable(
        new Glob('**/*.{ts,css}').scanSync({ cwd: path.join(root, 'src') }),
      ),
      isMapped,
    ),
  )

  const missing = Array.sort(
    Array.filter([...files], file => !named.has(file)),
    String.Order,
  )
  const stale = Array.sort(
    Array.filter([...named], file => !files.has(file)),
    String.Order,
  )

  for (const file of missing) {
    yield* Console.error(
      `src/${file}: not in its layer's file table (src/<layer>/${README}). Add it to a row, with what it holds.`,
    )
  }
  for (const file of stale) {
    yield* Console.error(
      `src/${file}: named in its layer's file table (src/<layer>/${README}), but not in src. Drop or rename it.`,
    )
  }
  if (missing.length + stale.length > 0) {
    return yield* TableDrifted.make({ count: missing.length + stale.length })
  }
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
