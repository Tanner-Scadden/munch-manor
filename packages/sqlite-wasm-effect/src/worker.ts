import type { Duration } from 'effect'
import { Array, Effect, Function, Queue, Stream, pipe } from 'effect'

import { openEngine, warmEngine } from './Engine'
import { decodeRequest, encodeResponse } from './Protocol'
import { makeServer } from './Server'

// WORKER

// NOTE: the slice of a dedicated worker's global scope this needs. A
// `DedicatedWorkerGlobalScope` fits it, and so does a test double.
export interface WorkerScope {
  readonly postMessage: (message: unknown) => void
  readonly addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void,
  ) => void
}

export interface WorkerOptions {
  readonly transactionIdleTimeout?: Duration.Input | undefined
}

const messagesFrom = (scope: WorkerScope): Stream.Stream<unknown> =>
  Stream.callback<unknown>(queue =>
    Effect.sync(() =>
      scope.addEventListener('message', event => {
        Queue.offerUnsafe(queue, event.data)
      }),
    ),
  )

export const serveWorker: {
  (options: WorkerOptions): (scope: WorkerScope) => Effect.Effect<void>
  (scope: WorkerScope, options: WorkerOptions): Effect.Effect<void>
} = Function.dual(
  2,
  (scope: WorkerScope, options: WorkerOptions): Effect.Effect<void> =>
    Effect.scoped(
      Effect.gen(function* () {
        const server = yield* makeServer({
          open: openEngine,
          transactionIdleTimeout: options.transactionIdleTimeout,
          respond: response =>
            pipe(
              encodeResponse(response),
              Effect.flatMap(encoded =>
                // NOTE: a worker scope's postMessage takes no targetOrigin.
                // oxlint-disable-next-line unicorn/require-post-message-target-origin
                Effect.sync(() => scope.postMessage(encoded)),
              ),
              Effect.ignore,
            ),
        })
        yield* Stream.runForEach(messagesFrom(scope), data =>
          pipe(
            decodeRequest(data),
            Effect.flatMap(server.offer),
            Effect.ignore,
          ),
        )
      }),
    ),
)

// NOTE: a request posted to a worker before its script has run is handed
// to whatever listens when the script's first run ends. The server's own
// listener goes on later, once its fiber gets that far, so this one goes on
// at once and holds anything that comes first until the server listens.
export const holdEarlyMessages = (scope: WorkerScope): WorkerScope => {
  const held: Array<MessageEvent> = []
  const listeners: Array<(event: MessageEvent) => void> = []
  scope.addEventListener('message', event => {
    if (listeners.length === 0) {
      held.push(event)
    } else {
      Array.forEach(listeners, listener => listener(event))
    }
  })
  return {
    // NOTE: a worker scope's postMessage takes no targetOrigin.
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    postMessage: message => scope.postMessage(message),
    addEventListener: (_type, listener) => {
      listeners.push(listener)
      Array.forEach(held.splice(0), listener)
    },
  }
}

// NOTE: the one line a worker entry file needs. See the README. It starts
// loading the wasm at once, so a worker started ahead of its first request
// has SQLite ready when the request comes.
export const runWorker = (options: WorkerOptions = {}): void => {
  const scope = holdEarlyMessages(self)
  warmEngine()
  Effect.runFork(serveWorker(scope, options))
}
