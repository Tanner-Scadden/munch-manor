import type { Duration } from 'effect'
import { Array, Effect, Function, Queue, Stream, pipe } from 'effect'

import { openEngine, warmEngine } from './Engine'
import { decodeRequest, encodeResponse } from './Protocol'
import { makeServer } from './Server'

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
    postMessage: message => scope.postMessage(message),
    addEventListener: (_type, listener) => {
      listeners.push(listener)
      Array.forEach(held.splice(0), listener)
    },
  }
}

export const runWorker = (options: WorkerOptions = {}): void => {
  const scope = holdEarlyMessages(self)
  warmEngine()
  Effect.runFork(serveWorker(scope, options))
}
