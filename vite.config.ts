import { DateTime, Schema } from 'effect'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { type Plugin, defineConfig, transformWithOxc } from 'vite'

import tailwindcss from '@tailwindcss/vite'

import {
  IS_SERVICE_WORKER_KILLED,
  KILL_SWITCH_SOURCE,
  SERVICE_WORKER_FILE,
  precacheDrift,
  precacheList,
  serviceWorkerSource,
} from './src/sw/precache.ts'
import { encodeJson } from './tools/json.ts'
import { spriteAtlas } from './tools/sprites/vitePlugin.ts'
import { foldkitBrandingViews } from './tools/vite/viewIdentity.ts'

const WORKER_SOURCE = resolve(import.meta.dirname, 'src/sw/worker.ts')

const DEV_BUILD = 'dev'

const nowMs = (): number => DateTime.toEpochMillis(DateTime.nowUnsafe())

const nonEmpty = (value: string | undefined): value is string =>
  value !== undefined && value !== ''

const git = (...args: ReadonlyArray<string>): string | undefined => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

// NOTE: a local deploy ships uncommitted changes, so a dirty tree gets a
// timestamp after its commit. Two such builds of one commit still differ.
const commitBuild = (): string | undefined => {
  const commit = git('rev-parse', 'HEAD')
  if (commit === undefined || commit === '') {
    return undefined
  }
  return git('status', '--porcelain') === ''
    ? commit
    : `${commit}-dirty-${nowMs()}`
}

const resolveBuild = (): string =>
  [process.env['BUILD_ID'], process.env['GITHUB_SHA'], commitBuild()].find(
    nonEmpty,
  ) ?? `time-${nowMs()}`

const encodeString = encodeJson(Schema.String)

const encodeVersion = encodeJson(Schema.Struct({ build: Schema.String }))

// Stamps every production build with an id and writes it to version.json,
// so an installed app can tell that a newer build is live.
// NOTE: shared with the service worker plugin, which names its cache after
// the build.
const build = { id: DEV_BUILD }

const buildId = (): Plugin => {
  return {
    name: 'munch-manor:build-id',
    config: (_config, { command }) => {
      build.id = command === 'build' ? resolveBuild() : DEV_BUILD
      return { define: { __BUILD_ID__: encodeString(build.id) } }
    },
    applyToEnvironment: environment => environment.name === 'client',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${encodeVersion({ build: build.id })}\n`,
      })
    },
  }
}

const filesUnder = (directory: string): ReadonlyArray<string> =>
  existsSync(directory)
    ? readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry =>
          relative(directory, join(entry.parentPath, entry.name))
            .split(sep)
            .join('/'),
        )
    : []

// Writes sw.js, the service worker that lets the game cold start offline
// (src/sw/worker.ts), with this build's id and its precache list: every file
// Vite emitted and every file copied from public/, less NOT_PRECACHED. Once
// dist is written it checks the list against the files on disk and fails the
// build if they drift. KILL_SERVICE_WORKER=1 writes the kill switch instead.
const serviceWorker = (): Plugin => {
  const state: { outDir: string; publicDir: string; precache: Array<string> } =
    { outDir: '', publicDir: '', precache: [] }
  return {
    name: 'munch-manor:service-worker',
    apply: 'build',
    applyToEnvironment: environment => environment.name === 'client',
    configResolved: config => {
      state.outDir = resolve(config.root, config.build.outDir)
      state.publicDir = config.publicDir
    },
    generateBundle: {
      order: 'post',
      async handler(_options, bundle) {
        state.precache = [
          ...precacheList(Object.keys(bundle), filesUnder(state.publicDir)),
        ]
        const isKilled =
          IS_SERVICE_WORKER_KILLED || process.env['KILL_SERVICE_WORKER'] === '1'
        const worker = await transformWithOxc(
          readFileSync(WORKER_SOURCE, 'utf8'),
          WORKER_SOURCE,
          { lang: 'ts', target: 'es2022' },
        )
        this.emitFile({
          type: 'asset',
          fileName: SERVICE_WORKER_FILE,
          source: isKilled
            ? KILL_SWITCH_SOURCE
            : serviceWorkerSource(build.id, state.precache, worker.code),
        })
      },
    },
    closeBundle() {
      const { missing, extra } = precacheDrift(
        filesUnder(state.outDir),
        state.precache,
      )
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `the service worker's precache list drifted from dist: missing ${missing.join(', ') || 'none'}, extra ${extra.join(', ') || 'none'}`,
        )
      }
    },
  }
}

const BUILT_STYLESHEET =
  /<link rel="stylesheet" crossorigin href="([^"]+\.css)">/

// NOTE: the built stylesheet would block the first paint, splash included,
// until it downloads. Preloading it instead lets the inline splash in
// index.html paint at once. The game waits for it before the splash goes:
// see LoadStyles in src/main.ts.
const loadStylesBehindSplash = (): Plugin => ({
  name: 'load-styles-behind-splash',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: html =>
      html.replace(
        BUILT_STYLESHEET,
        `<link id="game-styles" rel="preload" as="style" crossorigin href="$1" onload="this.rel='stylesheet'">`,
      ),
  },
})

const EARLY_ENTRY = 'src/early.ts'

// NOTE: src/early.ts starts the SQLite worker before the game's modules run
// (see src/storeEarly.ts). Bundled into the game's entry, it would wait for
// the whole bundle to download, and the worker would not start until the
// bundle finished its first long task. So the build emits it as its own small
// entry, and the page loads it ahead of the game's.
const earlyEntry = (): Plugin => ({
  name: 'munch-manor:early-entry',
  buildStart() {
    if (this.environment.mode === 'build') {
      this.emitFile({ type: 'chunk', id: EARLY_ENTRY, name: 'early' })
    }
  },
  transformIndexHtml: {
    order: 'post',
    handler: (_html, { bundle }) => {
      const maybeChunk = Object.values(bundle ?? {}).find(
        output =>
          output.type === 'chunk' &&
          output.facadeModuleId?.endsWith(EARLY_ENTRY) === true,
      )
      return [
        {
          tag: 'script',
          attrs: {
            type: 'module',
            crossorigin: true,
            src:
              maybeChunk === undefined
                ? `/${EARLY_ENTRY}`
                : `./${maybeChunk.fileName}`,
          },
          injectTo: 'head-prepend',
        },
      ]
    },
  },
})

export default defineConfig({
  base: './',
  plugins: [
    tailwindcss(),
    ...foldkitBrandingViews(),
    buildId(),
    loadStylesBehindSplash(),
    earlyEntry(),
    spriteAtlas(),
    serviceWorker(),
  ],
  // NOTE: sqlite-wasm finds sqlite3.wasm next to its own module with
  // `new URL(..., import.meta.url)`. Pre-bundling would move the module and
  // break that, so it is left out. The SQLite worker is an ES module worker,
  // since it shares chunks with the game.
  optimizeDeps: {
    entries: ['src/entry.ts'],
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
})
