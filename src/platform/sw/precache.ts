import { Array, Effect, Function, Order, Schema, String, pipe } from 'effect'

// The service worker's precache list, worked out at build time from the
// files Vite emits and the files it copies from public/, so the list never
// drifts from what is deployed. vite.config.ts calls these; the worker itself
// is src/platform/sw/worker.ts. See "How updates reach installed apps" in PLATFORM.md.

export const SERVICE_WORKER_FILE = 'sw.js'

const SHELL_FILE = 'index.html'

// NOTE: the shell is cached under the root URL, the one a navigation asks
// for. Cloudflare answers /index.html with a redirect to /, and a redirected
// response cannot answer a navigation.
export const SHELL_URL = './'

// NOTE: files that are deployed but never precached. version.json must always
// come from the network, so a build can tell that a newer one is live; the
// worker never caches itself; _headers is read by Cloudflare, not served; the
// og image is only for link previews.
const NOT_PRECACHED: ReadonlySet<string> = new Set([
  'version.json',
  SERVICE_WORKER_FILE,
  '_headers',
  'og-image.png',
])

const isPrecached = (fileName: string): boolean =>
  !NOT_PRECACHED.has(fileName) &&
  !String.endsWith('.map')(fileName) &&
  !String.startsWith('.vite/')(fileName)

const toUrl = (fileName: string): string =>
  fileName === SHELL_FILE ? SHELL_URL : fileName

// Every deployed file the game needs to cold start offline, as URLs relative
// to the worker: the shell, every hashed chunk, stylesheet, wasm, and worker
// Vite emits, and the icons and manifest from public/. Sorted, so one build
// always writes the same worker.
export const precacheList: {
  (
    publicFiles: ReadonlyArray<string>,
  ): (emittedFiles: ReadonlyArray<string>) => ReadonlyArray<string>
  (
    emittedFiles: ReadonlyArray<string>,
    publicFiles: ReadonlyArray<string>,
  ): ReadonlyArray<string>
} = Function.dual(
  2,
  (
    emittedFiles: ReadonlyArray<string>,
    publicFiles: ReadonlyArray<string>,
  ): ReadonlyArray<string> =>
    pipe(
      Array.appendAll(emittedFiles, publicFiles),
      Array.filter(isPrecached),
      Array.map(toUrl),
      Array.dedupe,
      Array.sort(Order.String),
    ),
)

// The deployed files the precache list and the not precached list both miss,
// and the list's entries that were not deployed. Both are empty for a sound
// build; the build fails otherwise.
export const precacheDrift: {
  (precache: ReadonlyArray<string>): (
    deployedFiles: ReadonlyArray<string>,
  ) => Readonly<{
    missing: ReadonlyArray<string>
    extra: ReadonlyArray<string>
  }>
  (
    deployedFiles: ReadonlyArray<string>,
    precache: ReadonlyArray<string>,
  ): Readonly<{
    missing: ReadonlyArray<string>
    extra: ReadonlyArray<string>
  }>
} = Function.dual(
  2,
  (
    deployedFiles: ReadonlyArray<string>,
    precache: ReadonlyArray<string>,
  ): Readonly<{
    missing: ReadonlyArray<string>
    extra: ReadonlyArray<string>
  }> => {
    const deployedUrls = pipe(deployedFiles, Array.filter(isPrecached))
    const expected = Array.map(deployedUrls, toUrl)
    return {
      missing: Array.filter(expected, url => !precache.includes(url)),
      extra: Array.filter(precache, url => !expected.includes(url)),
    }
  },
)

// NOTE: worker.ts is a module to TypeScript, so its globals can be declared,
// but sw.js is registered as a classic script, which Safari and Firefox load
// everywhere. The empty export is the only module syntax in it.
const EMPTY_EXPORT = /^export\s*\{\s*\};?[ \t]*$/gm

// NOTE: the build id and the precache list go into sw.js as JSON literals.
const BuildJson = Schema.fromJsonString(Schema.String)
const PrecacheJson = Schema.fromJsonString(Schema.Array(Schema.String))

// The worker's source with this build's id and precache list in front of
// it. A new build always changes the bytes of sw.js, which is how the
// browser notices a new worker.
export const serviceWorkerSource: {
  (
    precache: ReadonlyArray<string>,
    workerCode: string,
  ): (build: string) => Effect.Effect<string, Schema.SchemaError>
  (
    build: string,
    precache: ReadonlyArray<string>,
    workerCode: string,
  ): Effect.Effect<string, Schema.SchemaError>
} = Function.dual(
  3,
  (
    build: string,
    precache: ReadonlyArray<string>,
    workerCode: string,
  ): Effect.Effect<string, Schema.SchemaError> =>
    Effect.gen(function* () {
      const buildJson = yield* Schema.encodeEffect(BuildJson)(build)
      const precacheJson = yield* Schema.encodeEffect(PrecacheJson)(precache)
      return Array.join(
        [
          `const BUILD = ${buildJson};`,
          `const PRECACHE = ${precacheJson};`,
          String.replace(EMPTY_EXPORT, '')(workerCode),
        ],
        '\n',
      )
    }),
)

// NOTE: the kill switch. Set this to true and push to ship it; a source
// change also makes the deploy rebuild, where an env var alone would not.
// KILL_SERVICE_WORKER=1 does the same for one local build.
export const IS_SERVICE_WORKER_KILLED: boolean = false

// With the kill switch on, sw.js takes over
// at once, deletes every cache the game made, unregisters itself, and reloads
// open pages, which then load straight from the network.
export const KILL_SWITCH_SOURCE = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('munch-manor-')).map(key => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url)))),
  );
});
`
