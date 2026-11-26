import { Duration, Effect, Option, Schema, pipe } from 'effect'

import { describeError } from '../shared/describeError'
import { DEV_BUILD } from './version'

const TEST_BUILD = 'test'

export const isUsingServiceWorker = (runningBuild: string): boolean =>
  runningBuild !== DEV_BUILD && runningBuild !== TEST_BUILD

const SERVICE_WORKER_FILE = 'sw.js'

const SKIP_WAITING = 'SkipWaiting'

const INSTALL_TIMEOUT = Duration.seconds(15)
const TAKE_OVER_TIMEOUT = Duration.seconds(5)

export class ServiceWorkerError extends Schema.TaggedError<
  ServiceWorkerError,
  { readonly brand: unique symbol }
>()('ServiceWorkerError', {
  reason: Schema.String,
}) {}

const container: Effect.Effect<ServiceWorkerContainer, ServiceWorkerError> =
  Effect.suspend(() =>
    'serviceWorker' in navigator
      ? Effect.succeed(navigator.serviceWorker)
      : Effect.fail(
          ServiceWorkerError.make({ reason: 'no service worker support' }),
        ),
  )

const attempt = <A>(
  try_: () => Promise<A>,
): Effect.Effect<A, ServiceWorkerError> =>
  Effect.tryPromise({
    try: try_,
    catch: error => ServiceWorkerError.make({ reason: describeError(error) }),
  })

const maybeRegistration: Effect.Effect<
  Option.Option<ServiceWorkerRegistration>,
  ServiceWorkerError
> = pipe(
  container,
  Effect.flatMap(workers => attempt(() => workers.getRegistration())),
  Effect.map(Option.fromNullishOr),
)

export const registerServiceWorker: Effect.Effect<void, ServiceWorkerError> =
  pipe(
    container,
    Effect.flatMap(workers =>
      attempt(() =>
        workers.register(new URL(SERVICE_WORKER_FILE, document.baseURI).href, {
          updateViaCache: 'none',
        }),
      ),
    ),
    Effect.asVoid,
  )

export const updateServiceWorker: Effect.Effect<void, ServiceWorkerError> =
  pipe(
    maybeRegistration,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: registration => attempt(() => registration.update()),
      }),
    ),
    Effect.asVoid,
  )

const isSettled = (worker: ServiceWorker): boolean =>
  worker.state !== 'installing'

const awaitInstalled = (
  worker: ServiceWorker,
): Effect.Effect<void, ServiceWorkerError> =>
  pipe(
    Effect.callback<void>((resume, signal) => {
      if (isSettled(worker)) {
        resume(Effect.void)
        return
      }
      const onChange = () => {
        if (isSettled(worker)) {
          resume(Effect.void)
        }
      }
      worker.addEventListener('statechange', onChange, { signal })
    }),
    Effect.timeoutOrElse({
      duration: INSTALL_TIMEOUT,
      orElse: () =>
        Effect.fail(ServiceWorkerError.make({ reason: 'install timed out' })),
    }),
  )

const awaitWaitingWorker = (
  registration: ServiceWorkerRegistration,
): Effect.Effect<Option.Option<ServiceWorker>, ServiceWorkerError> =>
  Effect.gen(function* () {
    yield* Effect.ignore(attempt(() => registration.update()))
    const installing = registration.installing
    if (installing !== null) {
      yield* awaitInstalled(installing)
    }
    return Option.fromNullishOr(registration.waiting)
  })

const takeOver = (
  workers: ServiceWorkerContainer,
  waiting: ServiceWorker,
): Effect.Effect<void, ServiceWorkerError> =>
  pipe(
    Effect.callback<void>((resume, signal) => {
      workers.addEventListener('controllerchange', () => resume(Effect.void), {
        once: true,
        signal,
      })
      waiting.postMessage(SKIP_WAITING, [])
    }),
    Effect.timeoutOrElse({
      duration: TAKE_OVER_TIMEOUT,
      orElse: () =>
        Effect.fail(ServiceWorkerError.make({ reason: 'take over timed out' })),
    }),
  )

export const activateNewBuild: Effect.Effect<void, ServiceWorkerError> =
  Effect.gen(function* () {
    const workers = yield* container
    const maybeFound = yield* maybeRegistration
    if (Option.isNone(maybeFound)) {
      return
    }
    const maybeWaiting = yield* awaitWaitingWorker(maybeFound.value)
    if (Option.isSome(maybeWaiting)) {
      yield* takeOver(workers, maybeWaiting.value)
    }
  })
