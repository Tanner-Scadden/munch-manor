// The child processes the determinism tools run: a command's output, a
// binary from infra's packages, and a local workerd for the length of a
// request.

import {
  Array,
  Effect,
  FileSystem,
  Option,
  Path,
  Schema,
  type Scope,
  String,
} from 'effect'
import type { PlatformError } from 'effect/PlatformError'
import { ChildProcess, type ChildProcessSpawner } from 'effect/process'

import { textOf } from '../node'

class CommandFailed extends Schema.TaggedError<
  CommandFailed,
  { readonly brand: unique symbol }
>()('CommandFailed', { message: Schema.String }) {}

// NOTE: a command's whole stdout, failing with its stderr unless it exits 0.
/** @stability unstable */
export const commandOutput = ({
  command,
  args,
  cwd,
  env = {},
}: Readonly<{
  command: string
  args: ReadonlyArray<string>
  cwd: string
  // NOTE: added to this process's own environment.
  env?: Readonly<Record<string, string>>
}>): Effect.Effect<
  string,
  CommandFailed,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(command, args, {
        cwd,
        env,
        extendEnv: true,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = yield* Effect.all(
        [textOf(handle.stdout), textOf(handle.stderr), handle.exitCode],
        { concurrency: 'unbounded' },
      )
      if (code !== 0) {
        return yield* CommandFailed.make({
          message: `${command} failed: ${stderr}`,
        })
      }
      return stdout
    }),
  ).pipe(
    Effect.catchTag('PlatformError', error =>
      Effect.fail(
        CommandFailed.make({ message: `${command}: ${error.message}` }),
      ),
    ),
  )

const fileExists = (
  path: string,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false))
  })

// NOTE: a binary from infra's packages, in this checkout or, from a
// worktree with none installed, in the main one. `override` comes first.
/** @stability unstable */
export const infraBinary = ({
  root,
  name,
  override,
}: Readonly<{
  root: string
  name: string
  override: Option.Option<string>
}>): Effect.Effect<
  Option.Option<string>,
  never,
  FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const commonDir = yield* commandOutput({
      command: 'git',
      args: ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      cwd: root,
    }).pipe(
      Effect.map(String.trim),
      Effect.orElseSucceed(() => ''),
    )
    const candidates = Array.getSomes([
      override,
      Option.some(path.resolve(root, `infra/node_modules/.bin/${name}`)),
      commonDir === ''
        ? Option.none()
        : Option.some(
            path.resolve(commonDir, `../infra/node_modules/.bin/${name}`),
          ),
    ])
    return yield* Effect.findFirst(candidates, fileExists)
  })

// NOTE: workerd serving `config` from `cwd` for as long as the scope lasts,
// its stderr passed through.
/** @stability unstable */
export const serveWorkerd = ({
  binary,
  config,
  cwd,
}: Readonly<{ binary: string; config: string; cwd: string }>): Effect.Effect<
  void,
  PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.asVoid(
    ChildProcess.make(binary, ['serve', config], {
      cwd,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
    }),
  )
