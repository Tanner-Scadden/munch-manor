import { Console, Effect, Path, Schema, String } from 'effect'

import { encodeJson } from '../json'

class BuildFailed extends Schema.TaggedError<
  BuildFailed,
  { readonly brand: unique symbol }
>()('BuildFailed', { message: Schema.String }) {}

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

export const bundle = ({
  outdir,
  entry,
  target,
  format,
}: Readonly<{
  outdir: string
  entry: string
  target: 'node' | 'browser'
  format: 'esm' | 'iife'
}>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const result = yield* Effect.tryPromise({
      try: () =>
        Bun.build({
          entrypoints: [entry],
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
