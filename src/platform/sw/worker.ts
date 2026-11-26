export {}

declare const self: ServiceWorkerGlobalScope
declare const BUILD: string
declare const PRECACHE: ReadonlyArray<string>

const CACHE_PREFIX = 'munch-manor-'
const CACHE_NAME = `${CACHE_PREFIX}${BUILD}`
const SHELL_URL = new URL('./', self.location.href).href
const NAVIGATION_TIMEOUT_MS = 3000
const SKIP_WAITING = 'SkipWaiting'

const precachedUrls = new Set(
  PRECACHE.map(path => new URL(path, self.location.href).href),
)

const withoutRedirect = async (response: Response): Promise<Response> =>
  response.redirected
    ? new Response(await response.blob(), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response

const fetchForCache = async (url: string): Promise<Response> => {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`)
  }
  return withoutRedirect(response)
}

const assertShellMatches = async (shell: Response): Promise<void> => {
  const html = await shell.clone().text()
  const named = html.match(/assets\/[\w.-]+/g) ?? []
  const strangers = named.filter(
    path => !precachedUrls.has(new URL(path, SHELL_URL).href),
  )
  if (strangers.length > 0) {
    throw new Error(`the shell is not build ${BUILD}: ${strangers.join(', ')}`)
  }
}

const precache = async (): Promise<void> => {
  const cache = await caches.open(CACHE_NAME)
  const responses = await Promise.all(
    [...precachedUrls].map(
      async url => [url, await fetchForCache(url)] as const,
    ),
  )
  const shell = responses.find(([url]) => url === SHELL_URL)
  if (shell !== undefined) {
    await assertShellMatches(shell[1])
  }
  await Promise.all(
    responses.map(([url, response]) => cache.put(url, response)),
  )
}

self.addEventListener('install', event => {
  event.waitUntil(precache())
})

const deleteOldCaches = async (): Promise<void> => {
  const names = await caches.keys()
  await Promise.all(
    names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)),
  )
}

self.addEventListener('activate', event => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()))
})

self.addEventListener('message', event => {
  if (event.data === SKIP_WAITING) {
    event.waitUntil(self.skipWaiting())
  }
})

const cachedShell = async (): Promise<Response | undefined> => {
  const cache = await caches.open(CACHE_NAME)
  return cache.match(SHELL_URL)
}

const timeout = (ms: number): Promise<undefined> =>
  new Promise(resolve => setTimeout(() => resolve(undefined), ms))

const isServerError = (response: Response): boolean => response.status >= 500

const networkFirstShell = async (request: Request): Promise<Response> => {
  const network = fetch(request)
  const settled = network.then(
    response => (isServerError(response) ? undefined : response),
    () => undefined,
  )
  const early = await Promise.race([settled, timeout(NAVIGATION_TIMEOUT_MS)])
  if (early !== undefined) {
    return early
  }
  const shell = await cachedShell()
  if (shell !== undefined) {
    return shell
  }
  return network
}

const cacheFirst = async (request: Request): Promise<Response> => {
  const own = await caches.open(CACHE_NAME)
  const cached =
    (await own.match(request, { ignoreVary: true })) ??
    (await caches.match(request, { ignoreVary: true }))
  return cached ?? fetch(request)
}

const withoutSearch = (url: URL): string => `${url.origin}${url.pathname}`

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstShell(request))
  } else if (precachedUrls.has(withoutSearch(url))) {
    event.respondWith(cacheFirst(request))
  }
})
