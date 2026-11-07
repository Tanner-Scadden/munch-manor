import type { Cause } from 'effect'
import {
  Array,
  Effect,
  Option,
  Queue,
  Ref,
  Scope,
  Semaphore,
  Stream,
  pipe,
} from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import {
  type ClientMessage,
  type ServerMessage,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from './Protocol'
import type { ScopeDefinition } from './Scope'
import { parseScopeId } from './Scope'
import {
  type Authenticate,
  type Connection,
  OPENED,
  type ScopeServer,
  type ScopeServerError,
  handleMessage,
  makeScopeServer,
} from './Server'
import { type Channel, type Transport, TransportError } from './Sync'

// NOTE: an in-process authority and a fake network, for tests. The host
// keeps one ScopeServer per scope, each over its own database as a Durable
// Object would, handles one message at a time per scope, and fans deltas
// out to every joined connection. Each client gets its own Network, which
// can go offline and, from a seed, drop (closing the connection, as a lost
// socket does), duplicate, and delay messages. Delays reorder what the
// server sends; what a client sends keeps its order, as a WebSocket does.

// RANDOM

const mulberry32 = (seed: number): number => {
  const t = (seed + 0x6d2b79f5) | 0
  const a = Math.imul(t ^ (t >>> 15), t | 1)
  const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a
  return ((b ^ (b >>> 14)) >>> 0) / 4294967296
}

const makeRandom = (seed: number) =>
  Effect.map(Ref.make(seed), state =>
    Ref.modify(state, current => [mulberry32(current), current + 1]),
  )

// HOST

/** @stability unstable */
export interface HostOptions {
  readonly definitions: ReadonlyArray<ScopeDefinition>
  readonly openDatabase: (
    scope: string,
  ) => Effect.Effect<SqlClient.SqlClient, never, Scope.Scope>
  readonly authenticate: Authenticate
  readonly logTail?: number | undefined
  readonly snapshotAfter?: number | undefined
}

interface Peer {
  readonly id: number
  readonly scope: string
  readonly connection: Ref.Ref<Connection>
  readonly deliver: (message: ServerMessage) => Effect.Effect<void>
}

interface Scoped {
  readonly server: ScopeServer
  readonly lock: Semaphore.Semaphore
}

/** @stability unstable */
export interface Host {
  readonly server: (
    scope: string,
  ) => Effect.Effect<ScopeServer, ScopeServerError | SqlError.SqlError>
  readonly network: (options?: NetworkOptions) => Effect.Effect<Network>
  readonly messagesHandled: Effect.Effect<number>
}

export interface NetworkOptions {
  readonly seed?: number | undefined
  readonly drop?: number | undefined
  readonly duplicate?: number | undefined
  readonly maxDelayMs?: number | undefined
}

export interface Network {
  readonly transport: Transport
  readonly setOnline: (online: boolean) => Effect.Effect<void>
  readonly faults: Effect.Effect<Faults>
}

export interface Faults {
  readonly dropped: number
  readonly duplicated: number
}

/** @stability unstable */
export const makeHost = (
  options: HostOptions,
): Effect.Effect<Host, never, Scope.Scope> =>
  Effect.gen(function* () {
    const scope_1 = yield* Effect.scope
    // NOTE: the host's own child scope, made now, so what it opens later
    // (each scope's database, opened on its first message) closes when the
    // host does: after every client that connected since. Opened straight
    // into the caller's scope, a database closed before the clients using it,
    // and a client mid-message at the end waited out its request timeout.
    const outer = yield* Scope.fork(scope_1)
    const servers = yield* Ref.make<ReadonlyMap<string, Scoped>>(new Map())
    const creating = yield* Semaphore.make(1)
    const peers = yield* Ref.make<ReadonlyArray<Peer>>([])
    const nextPeer = yield* Ref.make(0)
    const handled = yield* Ref.make(0)

    const scoped = (scope: string) =>
      creating.withPermit(
        Effect.gen(function* () {
          const known = (yield* Ref.get(servers)).get(scope)
          if (known !== undefined) {
            return known
          }
          const definition = yield* Option.match(
            Option.flatMap(parseScopeId(scope), address =>
              Array.findFirst(
                options.definitions,
                candidate => candidate.kind === address.kind,
              ),
            ),
            {
              onNone: () =>
                Effect.die(new Error(`No definition for scope ${scope}`)),
              onSome: Effect.succeed,
            },
          )
          const sql = yield* Effect.provideService(
            options.openDatabase(scope),
            Scope.Scope,
            outer,
          )
          const server = yield* Effect.provideService(
            makeScopeServer({
              definition,
              scope,
              logTail: options.logTail,
              snapshotAfter: options.snapshotAfter,
            }),
            SqlClient.SqlClient,
            sql,
          )
          const entry: Scoped = { server, lock: yield* Semaphore.make(1) }
          yield* Ref.update(servers, map => new Map([...map, [scope, entry]]))
          return entry
        }),
      )

    const receive = (peer: Peer, message: ClientMessage) =>
      Effect.gen(function* () {
        const entry = yield* Effect.orDie(scoped(peer.scope))
        yield* entry.lock.withPermit(
          Effect.gen(function* () {
            yield* Ref.update(handled, n => n + 1)
            const connection = yield* Ref.get(peer.connection)
            const result = yield* handleMessage(
              entry.server,
              options.authenticate,
              connection,
              message,
            )
            yield* Ref.set(peer.connection, result.connection)
            const everyone = yield* Ref.get(peers)
            const joined = yield* Effect.filter(everyone, other =>
              other.scope === peer.scope
                ? Effect.map(
                    Ref.get(other.connection),
                    state => state._tag === 'Joined',
                  )
                : Effect.succeed(false),
            )
            yield* Effect.forEach(
              result.broadcast,
              broadcast =>
                Effect.forEach(joined, other => other.deliver(broadcast), {
                  discard: true,
                }),
              { discard: true },
            )
            yield* Effect.forEach(result.reply, peer.deliver, {
              discard: true,
            })
          }),
        )
      })

    const network = (networkOptions: NetworkOptions = {}) =>
      Effect.gen(function* () {
        const random = yield* makeRandom(networkOptions.seed ?? 1)
        const online = yield* Ref.make(true)
        const closers = yield* Ref.make<ReadonlyArray<Effect.Effect<void>>>([])
        const drop = networkOptions.drop ?? 0
        const duplicate = networkOptions.duplicate ?? 0
        const maxDelayMs = networkOptions.maxDelayMs ?? 0
        const faults = yield* Ref.make<Faults>({ dropped: 0, duplicated: 0 })
        const dropped = Ref.update(faults, count => ({
          dropped: count.dropped + 1,
          duplicated: count.duplicated,
        }))
        const copiesOf = Effect.map(random, roll => (roll < duplicate ? 2 : 1))
        const counted = (copies: number) =>
          copies > 1
            ? Ref.update(faults, count => ({
                dropped: count.dropped,
                duplicated: count.duplicated + 1,
              }))
            : Effect.void

        const open = (
          scope: string,
        ): Effect.Effect<Channel, TransportError, Scope.Scope> =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(online))) {
              return yield* TransportError.make({ reason: 'Offline' })
            }
            const inbox = yield* Queue.unbounded<
              ServerMessage,
              TransportError | Cause.Done
            >()
            const closed = yield* Ref.make(false)
            const close = (reason: string) =>
              Effect.andThen(
                Ref.set(closed, true),
                Queue.fail(inbox, TransportError.make({ reason })),
              )
            yield* Ref.update(closers, all =>
              Array.append(all, Effect.asVoid(close('Offline'))),
            )
            const id = yield* Ref.getAndUpdate(nextPeer, n => n + 1)

            const deliverToClient = (message: ServerMessage) =>
              Effect.gen(function* () {
                if (yield* Ref.get(closed)) {
                  return
                }
                if ((yield* random) < drop) {
                  yield* dropped
                  yield* close('Dropped by the network')
                  return
                }
                const wire = yield* Effect.orDie(encodeServerMessage(message))
                const decoded = yield* Effect.orDie(decodeServerMessage(wire))
                const copies = yield* copiesOf
                yield* counted(copies)
                const delayMs = Math.floor((yield* random) * maxDelayMs)
                yield* pipe(
                  Effect.sleep(delayMs),
                  Effect.andThen(
                    Effect.repeat(Queue.offer(inbox, decoded), {
                      times: copies - 1,
                    }),
                  ),
                  Effect.forkIn(outer),
                )
              }).pipe(Effect.asVoid)

            const peer: Peer = {
              id,
              scope,
              connection: yield* Ref.make(OPENED),
              deliver: deliverToClient,
            }
            yield* Ref.update(peers, all => Array.append(all, peer))
            yield* Effect.addFinalizer(() =>
              Effect.andThen(
                Ref.set(closed, true),
                Ref.update(peers, all =>
                  Array.filter(all, other => other.id !== id),
                ),
              ),
            )

            const sendLock = yield* Semaphore.make(1)
            const send = (message: ClientMessage) =>
              sendLock.withPermit(
                Effect.gen(function* () {
                  if ((yield* Ref.get(closed)) || !(yield* Ref.get(online))) {
                    return yield* TransportError.make({ reason: 'Closed' })
                  }
                  if ((yield* random) < drop) {
                    yield* dropped
                    yield* close('Dropped by the network')
                    return
                  }
                  const wire = yield* Effect.orDie(encodeClientMessage(message))
                  const decoded = yield* Effect.orDie(decodeClientMessage(wire))
                  const copies = yield* copiesOf
                  yield* counted(copies)
                  yield* Effect.repeat(receive(peer, decoded), {
                    times: copies - 1,
                  })
                }),
              )

            return {
              send,
              messages: Stream.fromQueue(inbox),
            }
          })

        return {
          transport: { name: 'InProcess', open },
          faults: Ref.get(faults),
          setOnline: (next: boolean) =>
            Effect.gen(function* () {
              yield* Ref.set(online, next)
              if (!next) {
                const all = yield* Ref.getAndSet(closers, [])
                yield* Effect.all(all, { discard: true })
              }
            }),
        }
      })

    return {
      server: scope => Effect.map(scoped(scope), entry => entry.server),
      network,
      messagesHandled: Ref.get(handled),
    }
  })
