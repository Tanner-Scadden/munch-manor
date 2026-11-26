import { Effect, Option } from 'effect'

import type * as StoreSqlite from './storeSqlite.ts'

const STORE_WORKER = 'store-worker'

const earlyWorkers = new Map<typeof STORE_WORKER, Worker>()

const STORE_MODULE = 'store-module'

type StoreModule = typeof StoreSqlite

const storeModules = new Map<typeof STORE_MODULE, Promise<StoreModule>>()

export const loadStoreModule = (): Promise<StoreModule> => {
  const maybeLoading = storeModules.get(STORE_MODULE)
  if (maybeLoading !== undefined) {
    return maybeLoading
  }
  const loading = import('./storeSqlite.ts')
  storeModules.set(STORE_MODULE, loading)
  loading.catch(() => storeModules.delete(STORE_MODULE))
  return loading
}

export const STORE_NAME = 'munch-manor'

type LockResult = 'Granted' | 'Held'

const LEADER_LOCK = 'leader-lock'

const leaderLocks = new Map<typeof LEADER_LOCK, Promise<LockResult>>()

const holdForLifeOfPage = (): Promise<void> => Effect.runPromise(Effect.never)

const requestLeaderLock = (): Promise<LockResult> =>
  Effect.runPromise(
    Effect.callback<LockResult>(resume => {
      if (typeof navigator === 'undefined' || !('locks' in navigator)) {
        resume(Effect.succeed('Granted'))
        return
      }
      navigator.locks
        .request(`${STORE_NAME}:leader`, { ifAvailable: true }, lock => {
          if (lock === null) {
            resume(Effect.succeed('Held'))
            return undefined
          }
          resume(Effect.succeed('Granted'))
          return holdForLifeOfPage()
        })
        .catch(() => resume(Effect.succeed('Granted')))
    }),
  )

export const takeLeaderLock = (): Promise<LockResult> | undefined => {
  const maybeEarly = leaderLocks.get(LEADER_LOCK)
  leaderLocks.delete(LEADER_LOCK)
  return maybeEarly
}

const makeStoreWorker = (): Worker =>
  new Worker(new URL('./store.worker.ts', import.meta.url), {
    type: 'module',
    name: 'munch-manor-sqlite',
  })

const tryMakeStoreWorker = Option.liftThrowable(makeStoreWorker)

export const startStoreEarly = (): void => {
  if (typeof Worker === 'undefined' || earlyWorkers.has(STORE_WORKER)) {
    return
  }
  leaderLocks.set(LEADER_LOCK, requestLeaderLock())
  Option.map(tryMakeStoreWorker(), worker =>
    earlyWorkers.set(STORE_WORKER, worker),
  )
  loadStoreModule()
    .then(module => module.openPlayerDatabaseOnce())
    .catch(() => undefined)
}

export const takeStoreWorker = (): Worker => {
  const maybeEarly = earlyWorkers.get(STORE_WORKER)
  earlyWorkers.delete(STORE_WORKER)
  return maybeEarly ?? makeStoreWorker()
}

export const releaseEarlyStoreWorker = (): void => {
  earlyWorkers.get(STORE_WORKER)?.terminate()
  earlyWorkers.delete(STORE_WORKER)
}
