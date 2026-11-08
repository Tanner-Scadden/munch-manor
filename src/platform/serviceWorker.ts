import { Duration, Effect, Option, Schema, pipe } from 'effect'

import { describeError } from '../shared/describeError'
import { DEV_BUILD } from './version'

// The page's side of the service worker (src/platform/sw/worker.ts): registering it,
// asking it to look for a new build, and handing over to a new build when
// the player taps the update chip. Every failure here is ignored by the
// Commands that run these: without a worker the game works as it did before
// it had one, online only. See "How updates reach installed apps" in
// PLATFORM.md.

const TEST_BUILD = 'test'

// NOTE: the dev server, the tests, and the audit harness (which builds with
// the dev id) never register a worker.
export const isUsingServiceWorker = (runningBuild: string): boolean =>
  runningBuild !== DEV_BUILD && runningBuild !== TEST_BUILD

const SERVICE_WORKER_FILE = 'sw.js'

// NOTE: the message src/platform/sw/worker.ts waits for before it takes over.
const SKIP_WAITING = 'SkipWaiting'

const INSTALL_TIMEOUT = Duration.seconds(15)
const TAKE_OVER_TIMEOUT = Duration.seconds(5)

export class ServiceWorkerError extends Schema.TaggedError<
  ServiceWorkerError,
  { readonly brand: unique symbol }
>()('ServiceWorkerError', {
  reason: Schema.String,
}) {}

// NOTE: Safari's private mode, an insecure origin, and an itch.io iframe can
// all lack the container or refuse to register. Either is only a failure.
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

// NOTE: updateViaCache 'none' fetches sw.js past the HTTP cache on every
// check, on top of its no-cache header in public/_headers.
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

// Asks the browser to fetch sw.js now, so a newer build's worker installs in
// the background while the player is still on the old one.
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

// NOTE: the worker that will take over. A fresh check comes first, so a
// worker left waiting by an older deploy gives way to the live one's; if the
// check fails, the one already waiting still does.
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
      // NOTE: a ServiceWorker's postMessage takes no targetOrigin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      waiting.postMessage(SKIP_WAITING)
    }),
    Effect.timeoutOrElse({
      duration: TAKE_OVER_TIMEOUT,
      orElse: () =>
        Effect.fail(ServiceWorkerError.make({ reason: 'take over timed out' })),
    }),
  )

// Before the update chip reloads the page: lets the new build's worker take
// over, which deletes the old build's cache, so the reload and any later
// offline start both run the new build. With no worker, or one that fails to
// install in time, the reload goes ahead anyway. Online, the shell always
// comes from the network, so the build version.json names is the one that
// loads either way.
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
