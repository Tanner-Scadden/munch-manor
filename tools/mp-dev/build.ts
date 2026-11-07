// Builds the co-op dev page into tools/mp-dev/dist/page (gitignored): main.js and
// index.html, nothing else. The API origin it talks to comes from
// MP_DEV_API_ORIGIN (set by the preview deploy in infra/alchemy.run.ts),
// else the page's own origin; `?api=` on the page overrides either.
//   MP_DEV_API_ORIGIN=http://127.0.0.1:8798 bun tools/mp-dev/build.ts
import { Config, Console, Effect, FileSystem, Path, Schema } from 'effect'
import type { PlatformError } from 'effect/PlatformError'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson } from '../json'

const here = import.meta.dirname

class PageFailed extends Schema.TaggedError<
  PageFailed,
  { readonly brand: unique symbol }
>()('PageFailed', { message: Schema.String }) {}

const outdirOf = Effect.gen(function* () {
  const path = yield* Path.Path
  return path.resolve(here, 'dist/page')
})

/** @stability unstable */
export const buildPage = (
  apiOrigin: string,
): Effect.Effect<
  void,
  PageFailed | PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const outdir = yield* outdirOf
    yield* fs.remove(outdir, { recursive: true, force: true })
    yield* fs.makeDirectory(outdir, { recursive: true })
    const result = yield* Effect.tryPromise({
      try: () =>
        Bun.build({
          entrypoints: [path.resolve(here, 'main.ts')],
          outdir,
          target: 'browser',
          format: 'esm',
          minify: true,
          metafile: false,
          plugins: [],
          // NOTE: Bun's `define` takes the value as source text: a JSON
          // string.
          define: { __MP_API_ORIGIN__: encodeJson(Schema.String)(apiOrigin) },
        }),
      catch: error =>
        PageFailed.make({
          message: `The dev page did not build: ${globalThis.String(error)}`,
        }),
    })
    if (!result.success) {
      return yield* PageFailed.make({
        message: `The dev page did not build: ${globalThis.String(result.logs)}`,
      })
    }
    yield* fs.copyFile(
      path.resolve(here, 'index.html'),
      path.resolve(outdir, 'index.html'),
    )
  })

if (import.meta.main) {
  NodeRuntime.runMain(
    Effect.gen(function* () {
      const apiOrigin = yield* Config.String('MP_DEV_API_ORIGIN').pipe(
        Config.withDefault(''),
      )
      yield* buildPage(apiOrigin)
      const outdir = yield* outdirOf
      yield* Console.log(`Built the co-op dev page into ${outdir}`)
    }).pipe(Effect.provide(NodeServices.layer)),
  )
}
