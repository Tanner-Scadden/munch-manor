// NOTE: AGENTS.md "Where things are" is the map of `src`, so it must stay
// true. Fails when a module or stylesheet in `src` is not named in the first
// column of the file table, or when the table names a file that does not
// exist. Test files (`*.test.ts`) are left out: each sits beside what it
// tests.
//
//   bun tools/lint/fileTable.ts [root]

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

const TABLE_START = '### Where things are'
const TABLE_END = '### Elsewhere'

// NOTE: the script has printed every problem, so the runtime reports
// nothing more and exits with 1.
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

// NOTE: the files a row names: every backticked path in its first cell.
const namedIn = (table: string): ReadonlySet<string> =>
  new Set(
    Array.flatMap(
      Array.filter(String.split('\n')(table), line =>
        String.startsWith('| `')(line),
      ),
      (line: string) =>
        Array.map(
          Array.fromIterable(
            String.matchAll(/`([^`]+)`/g)(
              Option.getOrElse(Array.get(String.split('|')(line), 1), () => ''),
            ),
          ),
          ([, path]) => path ?? '',
        ),
    ),
  )

const isMapped = (file: string): boolean =>
  !String.endsWith('.test.ts')(file) && !String.endsWith('.d.ts')(file)

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  // NOTE: the repository, or another checkout of it given as the argument.
  const root = Option.getOrElse(Array.get(process.argv, 2), () =>
    path.resolve(import.meta.dirname, '../..'),
  )
  const agents = yield* fs.readFileString(path.join(root, 'AGENTS.md'))
  const maybeTable = Option.flatMap(
    Option.all([
      String.indexOf(TABLE_START)(agents),
      String.indexOf(TABLE_END)(agents),
    ]),
    ([start, end]) =>
      end < start
        ? Option.none()
        : Option.some(String.slice(start, end)(agents)),
  )
  if (Option.isNone(maybeTable)) {
    yield* Console.error(
      `tools/lint/fileTable.ts: AGENTS.md has no "${TABLE_START}" section before "${TABLE_END}".`,
    )
    return yield* TableDrifted.make({ count: 1 })
  }
  const named = namedIn(maybeTable.value)

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
      `src/${file}: not in AGENTS.md's file table. Add it to a row, with what it holds.`,
    )
  }
  for (const file of stale) {
    yield* Console.error(
      `AGENTS.md: the file table names ${file}, which is not in src. Drop or rename it.`,
    )
  }
  if (missing.length + stale.length > 0) {
    return yield* TableDrifted.make({ count: missing.length + stale.length })
  }
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
