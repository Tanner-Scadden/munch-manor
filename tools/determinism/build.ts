// Bundles the harness for the engines Bun cannot run directly, into
// tools/determinism/out (gitignored):
// - out/cli.js for Node,
// - out/page.html, a page with the harness inlined as a classic script, for
//   headless Chrome from a file URL (a module script would not load there),
// - out/worker.js for workerd.
// The game imports CHANGELOG.md with Vite's ?raw suffix, so a small plugin
// turns those imports into string modules, and import.meta.env gets what
// Vite would give a build with no sync server.
//   bun tools/determinism/build.ts

import { Console, Effect, FileSystem, Path, Schema, String } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { encodeJson } from '../json'

const here = import.meta.dirname

class BuildFailed extends Schema.TaggedError<
  BuildFailed,
  { readonly brand: unique symbol }
>()('BuildFailed', { message: Schema.String }) {}

// NOTE: Bun's `define` takes each value as source text, so strings and the
// env object go in as JSON.
const stringSource = encodeJson(Schema.String)
const envSource = encodeJson(
  Schema.Struct({
    DEV: Schema.Boolean,
    PROD: Schema.Boolean,
    MODE: Schema.String,
  }),
)

const rawPlugin = (path: Path.Path): Bun.BunPlugin => ({
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, args => ({
      path: path.resolve(
        path.dirname(args.importer),
        String.replace(/\?raw$/, '')(args.path),
      ),
      namespace: 'raw',
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, args =>
      Bun.file(args.path)
        .text()
        .then(text => ({
          contents: `export default ${stringSource(text)}`,
          loader: 'js',
        })),
    )
  },
})

const bundle = (
  outdir: string,
  entry: string,
  target: 'node' | 'browser',
  format: 'esm' | 'iife',
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const result = yield* Effect.tryPromise({
      try: () =>
        Bun.build({
          entrypoints: [path.resolve(here, entry)],
          outdir,
          target,
          format,
          minify: false,
          metafile: false,
          plugins: [rawPlugin(path)],
          define: {
            'import.meta.env': envSource({
              DEV: false,
              PROD: true,
              MODE: 'production',
            }),
            // NOTE: a classic script cannot name import.meta at all. Only
            // the on-device store's worker URL reads it, and the harness
            // never runs a Command.
            ...(format === 'iife'
              ? { 'import.meta.url': stringSource('file:///determinism/') }
              : {}),
          },
        }),
      catch: error =>
        BuildFailed.make({
          message: `build failed for ${entry}: ${globalThis.String(error)}`,
        }),
    })
    const output = result.outputs[0]
    if (!result.success || output === undefined) {
      yield* Effect.forEach(result.logs, log => Console.error(log))
      return yield* BuildFailed.make({ message: `build failed for ${entry}` })
    }
    return output.path
  })

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outdir = path.resolve(here, 'out')
  yield* fs.makeDirectory(outdir, { recursive: true })
  yield* bundle(outdir, 'cli.ts', 'node', 'esm')
  yield* bundle(outdir, 'worker.ts', 'browser', 'esm')
  const pagePath = yield* bundle(outdir, 'page.ts', 'browser', 'iife')
  const pageScript = yield* fs.readFileString(pagePath)
  yield* fs.writeFileString(
    path.resolve(outdir, 'page.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>determinism</title></head><body><script>${String.replaceAll('</script', '<\\/script')(pageScript)}</script></body></html>`,
  )
  yield* Console.error(`Built the harness into ${outdir}`)
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
