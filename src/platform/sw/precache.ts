import { Array, Effect, Function, Order, Schema, String, pipe } from 'effect'

export const SERVICE_WORKER_FILE = 'sw.js'

const SHELL_FILE = 'index.html'

export const SHELL_URL = './'

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

const EMPTY_EXPORT = /^export\s*\{\s*\};?[ \t]*$/gm

const BuildJson = Schema.fromJsonString(Schema.String)
const PrecacheJson = Schema.fromJsonString(Schema.Array(Schema.String))

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

export const IS_SERVICE_WORKER_KILLED: boolean = false

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
