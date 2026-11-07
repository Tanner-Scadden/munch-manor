import {
  Array,
  Clock,
  Effect,
  FileSystem,
  Option,
  Schema,
  String,
} from 'effect'
import { ChildProcess } from 'effect/process'
import type { Plugin, ViteDevServer } from 'vite'

import type { SpriteAtlas } from '../../src/spriteAtlas.ts'
import { encodeJson, readJsonFile } from '../json.ts'
import { nodeRuntime, textOf } from '../node.ts'
import { AtlasEntries, SpriteAtlasManifest } from './manifest.ts'

// The sprite atlas in the build (docs/IMAGES_PLAN.md). ./build.ts writes the
// atlas, one file per room, and a manifest into a cache folder, reusing them
// when no sprite changed. `virtual:sprite-atlas` imports each file with
// `?url&no-inline`, so a build emits it with a content hash in its name (and
// the service worker's precache list picks it up from the bundle), and
// exports the manifest with those URLs. src/spriteAtlasBoot.ts hands it to
// the game before any sprite is built.
//
// A production build runs the generator first and waits for it. The dev
// server never waits: it starts the generator in the background and serves
// whatever atlas the cache holds, empty at first, and runs the generator
// again after each edit under src/. A sprite the atlas lacks, such as one
// just edited, is encoded in the page as before, and keys are content
// hashes, so a stale atlas can only miss, never draw old art. Once the
// generator finishes, the next reload draws from the new atlas.

const SPRITE_ATLAS_ID = 'virtual:sprite-atlas'
const RESOLVED_ID = `\0${SPRITE_ATLAS_ID}`

// NOTE: two folders up from this one, joined with `/` as Vite's own paths are.
const ROOT = Array.join(
  Array.dropRight(String.split('/')(import.meta.dirname), 2),
  '/',
)
const SOURCE_DIR = `${ROOT}/src/`
const GENERATOR = `${ROOT}/tools/sprites/build.ts`
const BUILD_CACHE_DIR = `${ROOT}/node_modules/.cache/munch-sprites`
const DEV_CACHE_DIR = `${ROOT}/node_modules/.cache/munch-sprites-dev`

const EMPTY_ATLAS_MODULE = 'export default { sources: [], entries: {} }\n'

class GeneratorFailed extends Schema.TaggedError<
  GeneratorFailed,
  { readonly brand: unique symbol }
>()('GeneratorFailed', { message: Schema.String }) {}

const generatorFailed = (output: string): GeneratorFailed =>
  GeneratorFailed.make({
    message: `the sprite atlas failed to build:\n${output}`,
  })

// NOTE: the generator writing `outDir`: its stdout and stderr together, in
// the order each ended, and its exit code.
const generate = (outDir: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make('bun', [GENERATOR, outDir], {
        cwd: ROOT,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [stdout, stderr, code] = yield* Effect.all(
        [textOf(handle.stdout), textOf(handle.stderr), handle.exitCode],
        { concurrency: 'unbounded' },
      )
      return { stdout, stderr, code }
    }),
  )

const runGenerator = (outDir: string) =>
  Effect.gen(function* () {
    const { stdout, stderr, code } = yield* generate(outDir).pipe(
      Effect.mapError(error => generatorFailed(error.message)),
    )
    if (code !== 0) {
      return yield* generatorFailed(stderr || stdout)
    }
    yield* Effect.sync(() => process.stdout.write(stdout))
  })

const manifestIn = (
  outDir: string,
): Effect.Effect<Option.Option<SpriteAtlas>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const manifestPath = `${outDir}/manifest.json`
    const isThere = yield* fs
      .exists(manifestPath)
      .pipe(Effect.orElseSucceed(() => false))
    if (!isThere) {
      return Option.none()
    }
    return yield* readJsonFile(SpriteAtlasManifest, manifestPath).pipe(
      Effect.asSome,
      Effect.orDie,
    )
  })

// NOTE: a build imports each file, so Vite emits it with a hashed name.
const builtAtlasModule = (outDir: string) =>
  Effect.map(manifestIn(outDir), maybeManifest =>
    Option.match(maybeManifest, {
      onNone: () => EMPTY_ATLAS_MODULE,
      onSome: manifest => {
        const imports = Array.map(
          manifest.sources,
          (name, index) =>
            `import source${index} from ${encodeJson(Schema.String)(`${outDir}/${name}?url&no-inline`)}`,
        )
        const sources = Array.map(
          manifest.sources,
          (_name, index) => `source${index}`,
        )
        return Array.join(
          [
            ...imports,
            `export default { sources: [${Array.join(sources, ', ')}], entries: ${encodeJson(AtlasEntries)(manifest.entries)} }`,
            '',
          ],
          '\n',
        )
      },
    }),
  )

// NOTE: the dev server serves the files itself, under DEV_URL_PREFIX. An
// import would go through Vite's resolver, which caches what it has seen in
// node_modules and so misses a file the generator has just written.
const DEV_URL_PREFIX = '/@munch-sprites/'

const devAtlasModule = Effect.map(manifestIn(DEV_CACHE_DIR), maybeManifest =>
  Option.match(maybeManifest, {
    onNone: () => EMPTY_ATLAS_MODULE,
    onSome: manifest => {
      const atlas: SpriteAtlas = {
        sources: Array.map(
          manifest.sources,
          name => `${DEV_URL_PREFIX}${name}`,
        ),
        entries: manifest.entries,
      }
      return `export default ${encodeJson(SpriteAtlasManifest)(atlas)}\n`
    },
  }),
)

const FILE_NAME = /^[\w-]+\.png$/

// NOTE: an atlas file from the dev cache, or None for any other name.
const devFile = (
  name: string,
): Effect.Effect<Option.Option<Uint8Array>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (!FILE_NAME.test(name)) {
      return Option.none()
    }
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFile(`${DEV_CACHE_DIR}/${name}`).pipe(Effect.option)
  })

const isSourceEdit = (file: string): boolean =>
  String.startsWith(SOURCE_DIR)(file) &&
  String.endsWith('.ts')(file) &&
  !String.endsWith('.test.ts')(file)

const REGENERATE_DELAY_MS = 300

// NOTE: one generator at a time. An edit while it runs asks for one more
// run after it, so the atlas always catches up with the last edit.
const regenerateInBackground = (server: ViteDevServer) => {
  const state: {
    isRunning: boolean
    isWanted: boolean
    timer: ReturnType<typeof globalThis.setTimeout> | undefined
  } = {
    isRunning: false,
    isWanted: false,
    timer: undefined,
  }
  const reload = () => {
    const graph = server.environments.client.moduleGraph
    const atlasModuleNode = graph.getModuleById(RESOLVED_ID)
    if (atlasModuleNode !== undefined) {
      graph.invalidateModule(atlasModuleNode)
    }
  }
  const generateOnce = Effect.gen(function* () {
    // NOTE: the generator's wall time, logged for whoever runs the dev server.
    const started = yield* Clock.currentTimeMillis
    const { stdout, stderr, code } = yield* generate(DEV_CACHE_DIR).pipe(
      Effect.catch(error =>
        Effect.succeed({ stdout: '', stderr: error.message, code: 1 }),
      ),
    )
    const finished = yield* Clock.currentTimeMillis
    yield* Effect.sync(() => {
      state.isRunning = false
      if (code === 0) {
        reload()
        server.config.logger.info(
          `${String.trim(`${stdout}${stderr}`)} (${finished - started} ms in the background)`,
          { timestamp: true },
        )
      } else {
        server.config.logger.warn(
          generatorFailed(`${stdout}${stderr}`).message,
          { timestamp: true },
        )
      }
      if (state.isWanted) {
        run()
      }
    })
  })
  const run = (): void => {
    state.isRunning = true
    state.isWanted = false
    nodeRuntime.runFork(generateOnce)
  }
  return () => {
    clearTimeout(state.timer)
    // NOTE: Vite calls the watcher outside any Effect: a plain debounce.
    /* oxlint-disable no-restricted-globals */
    // @effect-diagnostics-next-line globalTimers:off
    state.timer = setTimeout(() => {
      /* oxlint-enable no-restricted-globals */
      if (state.isRunning) {
        state.isWanted = true
      } else {
        run()
      }
    }, REGENERATE_DELAY_MS)
  }
}

export const spriteAtlas = (): Plugin => {
  const state = { isBuild: false }
  return {
    name: 'munch-manor:sprite-atlas',
    applyToEnvironment: environment => environment.name === 'client',
    configResolved(config) {
      state.isBuild = config.command === 'build'
    },
    configureServer(server) {
      server.middlewares.use(DEV_URL_PREFIX, (request, response, next) => {
        const name = String.slice(1)(request.url ?? '')
        nodeRuntime.runFork(
          Effect.flatMap(devFile(name), maybeFile =>
            Effect.sync(() =>
              Option.match(maybeFile, {
                onNone: () => next(),
                onSome: file => {
                  response.setHeader('Content-Type', 'image/png')
                  response.setHeader('Cache-Control', 'no-cache')
                  response.end(file)
                },
              }),
            ),
          ),
        )
      })
      const regenerate = regenerateInBackground(server)
      regenerate()
      server.watcher.on('change', file => {
        if (isSourceEdit(file)) {
          regenerate()
        }
      })
    },
    buildStart() {
      return state.isBuild
        ? nodeRuntime.runPromise(runGenerator(BUILD_CACHE_DIR))
        : undefined
    },
    resolveId: {
      filter: { id: /^virtual:sprite-atlas$/ },
      handler: id => (id === SPRITE_ATLAS_ID ? RESOLVED_ID : undefined),
    },
    load: {
      filter: { id: /^\0virtual:sprite-atlas$/ },
      handler: id => {
        if (id !== RESOLVED_ID) {
          return undefined
        }
        return nodeRuntime.runPromise(
          state.isBuild ? builtAtlasModule(BUILD_CACHE_DIR) : devAtlasModule,
        )
      },
    },
  }
}
