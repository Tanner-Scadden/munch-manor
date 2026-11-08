// NOTE: AGENTS.md "Folders" lays out `src`, and this keeps it so. Fails when
// a file sits straight in `src` (only `vite-env.d.ts` may), when a folder of
// `src` is not one of the layers, when a test (`*.test.ts`) is not in a
// `__tests__/` folder, when a fixture (`*.fixture.ts`) is in neither a
// `__tests__/` folder nor the test homes (`src/test/`), or when a module
// that is not a test or a fixture sits in a `__tests__/` folder.
// munch/folder-imports (tools/lint/munchPlugin.ts) checks what the folders
// import.
//
//   bun tools/lint/folders.ts [root]

import { Glob } from 'bun'
import {
  Array,
  Console,
  Effect,
  Option,
  Path,
  Runtime,
  Schema,
  String,
} from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { problemOf } from './folderRules'

// NOTE: the script has printed every problem, so the runtime reports
// nothing more and exits with 1.
class FoldersDrifted extends Schema.TaggedError<
  FoldersDrifted,
  { readonly brand: unique symbol }
>()('FoldersDrifted', {
  count: Schema.Finite,
}) {
  override get [Runtime.errorExitCode](): number {
    return 1
  }
  override readonly [Runtime.errorReported] = false
}

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  // NOTE: the repository, or another checkout of it given as the argument.
  const root = Option.getOrElse(Array.get(process.argv, 2), () =>
    path.resolve(import.meta.dirname, '../..'),
  )
  const files = Array.sort(
    Array.fromIterable(
      new Glob('**/*.{ts,css}').scanSync({ cwd: path.join(root, 'src') }),
    ),
    String.Order,
  )
  const problems = Array.getSomes(
    Array.map(files, file =>
      Option.map(problemOf(file), problem => `src/${file}: ${problem}`),
    ),
  )
  yield* Effect.forEach(problems, problem => Console.error(problem))
  if (problems.length > 0) {
    return yield* FoldersDrifted.make({ count: problems.length })
  }
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
