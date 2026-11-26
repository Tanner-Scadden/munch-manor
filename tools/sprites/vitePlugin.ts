import {
  Array,
  Clock,
  Effect,
  Fiber,
  FileSystem,
  Option,
  Result,
  Schema,
  String,
} from 'effect'
import { ChildProcess } from 'effect/process'
import type { Plugin, ViteDevServer } from 'vite'

import type { SpriteAtlas } from '../../src/art/atlas/spriteAtlas.ts'
import { encodeJson, readJsonFile } from '../json.ts'
import { nodeRuntime, textOf } from '../node.ts'
import { AtlasEntries, AtlasLevels, SpriteAtlasManifest } from './manifest.ts'

const SPRITE_ATLAS_ID = 'virtual:sprite-atlas'
const RESOLVED_ID = `\0${SPRITE_ATLAS_ID}`

const ROOT = Array.join(
  Array.dropRight(String.split('/')(import.meta.dirname), 2),
  '/',
)
const SOURCE_DIR = `${ROOT}/src/`
const GENERATOR = `${ROOT}/tools/sprites/build.ts`
const BUILD_CACHE_DIR = `${ROOT}/node_modules/.cache/munch-sprites`
const DEV_CACHE_DIR = `${ROOT}/node_modules/.cache/munch-sprites-dev`

const EMPTY_ATLAS_MODULE =
  'export default { sources: [], entries: {}, normals: [], levels: {} }\n'

class GeneratorFailed extends Schema.TaggedError<
  GeneratorFailed,
  { readonly brand: unique symbol }
>()('GeneratorFailed', { message: Schema.String }) {}

const generatorFailed = (output: string): GeneratorFailed =>
  GeneratorFailed.make({
    message: `the sprite atlas failed to build:\n${output}`,
  })

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

const builtAtlasModule = (outDir: string) =>
  Effect.map(manifestIn(outDir), maybeManifest =>
    Option.match(maybeManifest, {
      onNone: () => EMPTY_ATLAS_MODULE,
      onSome: manifest => {
        const importOf = (binding: string, name: string): string =>
          `import ${binding} from ${encodeJson(Schema.String)(`${outDir}/${name}?url&no-inline`)}`
        const imports = [
          ...Array.map(manifest.sources, (name, index) =>
            importOf(`source${index}`, name),
          ),
          ...Array.filterMap(manifest.normals, (name, index) =>
            name === null
              ? Result.failVoid
              : Result.succeed(importOf(`normal${index}`, name)),
          ),
        ]
        const sources = Array.map(
          manifest.sources,
          (_name, index) => `source${index}`,
        )
        const normals = Array.map(manifest.normals, (name, index) =>
          name === null ? 'null' : `normal${index}`,
        )
        return Array.join(
          [
            ...imports,
            `export default { sources: [${Array.join(sources, ', ')}], normals: [${Array.join(normals, ', ')}], entries: ${encodeJson(AtlasEntries)(manifest.entries)}, levels: ${encodeJson(AtlasLevels)(manifest.levels)} }`,
            '',
          ],
          '\n',
        )
      },
    }),
  )

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
        normals: Array.map(manifest.normals, name =>
          name === null ? null : `${DEV_URL_PREFIX}${name}`,
        ),
        entries: manifest.entries,
        levels: manifest.levels,
      }
      return `export default ${encodeJson(SpriteAtlasManifest)(atlas)}\n`
    },
  }),
)

const FILE_NAME = /^[\w-]+\.png$/

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

const regenerateInBackground = (server: ViteDevServer) => {
  const state: {
    isRunning: boolean
    isWanted: boolean
    waiting: Option.Option<Fiber.Fiber<void>>
  } = {
    isRunning: false,
    isWanted: false,
    waiting: Option.none(),
  }
  const reload = () => {
    const graph = server.environments.client.moduleGraph
    const atlasModuleNode = graph.getModuleById(RESOLVED_ID)
    if (atlasModuleNode !== undefined) {
      graph.invalidateModule(atlasModuleNode)
    }
  }
  const generateOnce = Effect.gen(function* () {
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
    const previous = state.waiting
    state.waiting = Option.some(
      nodeRuntime.runFork(
        Effect.gen(function* () {
          yield* Option.match(previous, {
            onNone: () => Effect.void,
            onSome: fiber => Fiber.interrupt(fiber),
          })
          yield* Effect.sleep(REGENERATE_DELAY_MS)
          yield* Effect.sync(() => {
            if (state.isRunning) {
              state.isWanted = true
            } else {
              run()
            }
          })
        }),
      ),
    )
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
