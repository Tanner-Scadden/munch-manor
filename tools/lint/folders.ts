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
