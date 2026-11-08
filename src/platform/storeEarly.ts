// NOTE: opening the save was the longest wait behind the splash: the SQLite
// chunk, the worker's script, its wasm, then the database, one after another
// and only once the whole game bundle had run. So src/platform/early.ts, which runs
// before the game's modules, asks for the leader lock, starts the worker,
// which loads its wasm at once, and opens the database (see
// openPlayerDatabaseOnce). The PlayerStore awaits that same open. A tab that
// follows another never takes the worker, so it is let go. This module
// imports nothing at runtime, so the early entry stays tiny.
//
// Everything here is asked for as early as it can be because the browser
// answers a lock request, a worker's reply, or a second import of a loaded
// chunk in a task of its own, and as the game loads those tasks waited
// behind the first render and every sprite image's load, for half a second
// on a desktop.

import type * as StoreSqlite from './storeSqlite'

const STORE_WORKER = 'store-worker'

const earlyWorkers = new Map<typeof STORE_WORKER, Worker>()

const STORE_MODULE = 'store-module'

type StoreModule = typeof StoreSqlite

const storeModules = new Map<typeof STORE_MODULE, Promise<StoreModule>>()

// NOTE: the PlayerStore awaits this same promise rather than importing the
// chunk again. A failed import is forgotten, so the next call tries again.
export const loadStoreModule = (): Promise<StoreModule> => {
  const maybeLoading = storeModules.get(STORE_MODULE)
  if (maybeLoading !== undefined) {
    return maybeLoading
  }
  const loading = import('./storeSqlite')
  storeModules.set(STORE_MODULE, loading)
  loading.catch(() => storeModules.delete(STORE_MODULE))
  return loading
}

// LEADER LOCK

// NOTE: the SQLite layer leads under `<name>:leader`, with this name.
export const STORE_NAME = 'munch-manor'

type LockResult = 'Granted' | 'Held'

const LEADER_LOCK = 'leader-lock'

const leaderLocks = new Map<typeof LEADER_LOCK, Promise<LockResult>>()

// NOTE: this runs at boot, before the Effect runtime exists, so it speaks
// plain promises.
// @effect-diagnostics-next-line newPromise:off
const NEVER_RELEASED = new Promise<void>(() => undefined)

// NOTE: the lock is held for the life of the page, as the database is. A
// browser without Web Locks, or one that refuses the request, leads on its
// own, as the layer does.
const requestLeaderLock = (): Promise<LockResult> =>
  // @effect-diagnostics-next-line newPromise:off
  new Promise(resolve => {
    if (typeof navigator === 'undefined' || !('locks' in navigator)) {
      resolve('Granted')
      return
    }
    navigator.locks
      .request(`${STORE_NAME}:leader`, { ifAvailable: true }, lock => {
        if (lock === null) {
          resolve('Held')
          return undefined
        }
        resolve('Granted')
        return NEVER_RELEASED
      })
      .catch(() => resolve('Granted'))
  })

// NOTE: the early answer, once. Without one the layer asks for itself, as
// it does again when this tab takes over from a closed one.
export const takeLeaderLock = (): Promise<LockResult> | undefined => {
  const maybeEarly = leaderLocks.get(LEADER_LOCK)
  leaderLocks.delete(LEADER_LOCK)
  return maybeEarly
}

// WORKER

const makeStoreWorker = (): Worker =>
  new Worker(new URL('./store.worker.ts', import.meta.url), {
    type: 'module',
    name: 'munch-manor-sqlite',
  })

export const startStoreEarly = (): void => {
  if (typeof Worker === 'undefined' || earlyWorkers.has(STORE_WORKER)) {
    return
  }
  leaderLocks.set(LEADER_LOCK, requestLeaderLock())
  try {
    earlyWorkers.set(STORE_WORKER, makeStoreWorker())
  } catch {
    // NOTE: the PlayerStore tries again when it opens, and falls back to
    // localStorage if the worker still will not start.
  }
  loadStoreModule()
    .then(module => module.openPlayerDatabaseOnce())
    .catch(() => undefined)
}

// NOTE: the worker started early, the first time, and a new one after that,
// such as when this tab takes over from a closed one.
export const takeStoreWorker = (): Worker => {
  const maybeEarly = earlyWorkers.get(STORE_WORKER)
  earlyWorkers.delete(STORE_WORKER)
  return maybeEarly ?? makeStoreWorker()
}

export const releaseEarlyStoreWorker = (): void => {
  earlyWorkers.get(STORE_WORKER)?.terminate()
  earlyWorkers.delete(STORE_WORKER)
}
