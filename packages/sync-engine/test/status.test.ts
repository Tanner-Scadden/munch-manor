import {
  Array,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Ref,
  Schema,
  Scope,
  Stream,
  SubscriptionRef,
} from 'effect'
import type { SqlError } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { describe, expect, it, test } from '@effect/vitest'

import { type Host, type Network, makeHost } from '../src/InProcess'
import {
  type Sync,
  type SyncStatus,
  type Transport,
  startSync,
} from '../src/Sync'
import { first, settle } from '../src/Testing'
import {
  type LocalDatabase,
  type Replica,
  ScopeStatus,
  ServerMessage,
  Settled,
  makeReplica,
  statusAtSessionStart,
} from '../src/index'
import {
  Claimed,
  Counted,
  FAST_TIMING,
  Notes,
  PLAYER,
  SCOPE,
  authenticate,
  openClientDatabase,
  openServerDatabase,
} from './fixtures'

// NOTE: every test runs on it.effect's TestClock and waits with settle (see
// src/Testing.ts), so time moves only when a test moves it.

interface Device {
  readonly database: LocalDatabase
  readonly replica: Replica
}

const openReplica = (
  database: LocalDatabase,
  scope = SCOPE,
): Effect.Effect<Replica, SqlError.SqlError> =>
  makeReplica({ definition: Notes, database, scope })

const openDevice = (
  scope = SCOPE,
): Effect.Effect<Device, SqlError.SqlError, Scope.Scope> =>
  Effect.gen(function* () {
    const database = yield* openClientDatabase
    const replica = yield* openReplica(database, scope)
    return { database, replica }
  })

const makeTestHost = () =>
  makeHost({
    definitions: [Notes],
    openDatabase: () => openServerDatabase,
    authenticate,
  })

const syncOver = (
  transport: Transport,
  replica: Replica,
  deviceId: string,
  playerId: Effect.Effect<string> = Effect.succeed(PLAYER),
) =>
  startSync({
    replica,
    transports: [transport],
    credentials: Effect.map(playerId, player => ({
      token: `${deviceId}:${player}`,
      clientId: deviceId,
    })),
    ...FAST_TIMING,
  })

const connect = (
  host: Host,
  replica: Replica,
  deviceId: string,
  playerId = PLAYER,
): Effect.Effect<{ net: Network; sync: Sync }, never, Scope.Scope> =>
  Effect.gen(function* () {
    const net = yield* host.network()
    const sync = yield* syncOver(
      net.transport,
      replica,
      deviceId,
      Effect.succeed(playerId),
    )
    return { net, sync }
  })

const isFreshReady = (status: ScopeStatus): boolean =>
  status._tag === 'Ready' && status.fresh

const connectionIs =
  (tag: SyncStatus['_tag']) =>
  (status: SyncStatus): boolean =>
    status._tag === tag

// NOTE: every status the replica's stream shows, in order, from now on. The
// recording fiber starts at once, so it has subscribed before this returns.
const recordStatuses = (replica: Replica) =>
  Effect.gen(function* () {
    const seen = yield* SubscriptionRef.make<ReadonlyArray<ScopeStatus>>([])
    yield* Effect.forkScoped(
      Stream.runForEach(replica.status, status =>
        SubscriptionRef.update(seen, Array.append(status)),
      ),
      { startImmediately: true },
    )
    return seen
  })

const lastSeen = (
  seen: SubscriptionRef.SubscriptionRef<ReadonlyArray<ScopeStatus>>,
  isDone: (status: ScopeStatus) => boolean,
) =>
  first(SubscriptionRef.changes(seen), statuses =>
    Option.exists(Array.last(statuses), isDone),
  )

describe('scope status', () => {
  it.effect('a new replica is idle, then loading, then ready and fresh', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const device = yield* openDevice()
      yield* device.replica.run(Counted, { kind: 'runs', count: 1 })
      expect(yield* device.replica.currentStatus).toEqual(
        ScopeStatus.cases.Idle.make({}),
      )
      const seen = yield* recordStatuses(device.replica)
      yield* connect(host, device.replica, 'phone')
      const statuses = yield* lastSeen(seen, isFreshReady)
      const tags = Array.dedupe(Array.map(statuses, status => status._tag))
      expect(tags).toEqual(['Idle', 'Loading', 'Ready'])
    }),
  )

  it.effect(
    'rows cached from an earlier session are ready offline, and fresh once back',
    () =>
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const database = yield* openClientDatabase
        const firstSession = yield* Scope.make()
        const firstReplica = yield* openReplica(database)
        const id = yield* firstReplica.run(Counted, { kind: 'runs', count: 2 })
        yield* Scope.provide(firstSession)(connect(host, firstReplica, 'phone'))
        yield* settle(firstReplica.awaitSettled(id))
        yield* Scope.close(firstSession, Exit.void)

        const notFresh = ScopeStatus.cases.Ready.make({ seq: 1, fresh: false })
        expect(yield* (yield* openReplica(database)).currentStatus).toEqual(
          notFresh,
        )
        // A tab closed after a receipt committed but before its status
        // moved: the stored seq is behind the confirmed one.
        const behind = yield* Schema.encodeEffect(
          Schema.fromJsonString(ScopeStatus),
        )(ScopeStatus.cases.Ready.make({ seq: 0, fresh: true }))
        yield* database.sql`UPDATE sync_status SET status = ${behind}`
        expect(yield* (yield* openReplica(database)).currentStatus).toEqual(
          notFresh,
        )
        // A database synced by a build from before the status table.
        yield* database.sql`DELETE FROM sync_status`
        const reopened = yield* openReplica(database)
        expect(yield* reopened.currentStatus).toEqual(notFresh)
        const { net, sync } = yield* connect(host, reopened, 'phone')
        yield* net.setOnline(false)
        yield* first(sync.status, connectionIs('Offline'))
        expect(yield* reopened.currentStatus).toEqual(
          ScopeStatus.cases.Ready.make({ seq: 1, fresh: false }),
        )
        yield* net.setOnline(true)
        const back = yield* first(reopened.status, isFreshReady)
        expect(back).toEqual(
          ScopeStatus.cases.Ready.make({ seq: 1, fresh: true }),
        )
      }),
  )

  it.effect('a dropped connection keeps a ready scope ready', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const device = yield* openDevice()
      const { net, sync } = yield* connect(host, device.replica, 'phone')
      yield* first(device.replica.status, isFreshReady)
      const seen = yield* recordStatuses(device.replica)
      yield* net.setOnline(false)
      yield* first(sync.status, connectionIs('Offline'))
      const id = yield* device.replica.run(Counted, {
        kind: 'runs',
        count: 3,
      })
      yield* net.setOnline(true)
      yield* first(sync.status, connectionIs('Online'))
      yield* settle(device.replica.awaitSettled(id))
      const confirmed = ScopeStatus.cases.Ready.make({ seq: 1, fresh: true })
      const statuses = yield* lastSeen(
        seen,
        status => ScopeStatus.isAnyOf(['Ready'])(status) && status.seq === 1,
      )
      expect(Array.every(statuses, isFreshReady)).toBe(true)
      expect(Array.last(statuses)).toEqual(Option.some(confirmed))
    }),
  )

  it.effect('a scope the server refuses before it is ready fails', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const device = yield* openDevice()
      yield* connect(host, device.replica, 'evil', 'mallory')
      const failed = yield* first(
        device.replica.status,
        status => status._tag === 'Failed',
      )
      expect(failed._tag === 'Failed' && failed.reason).toContain('Forbidden')
    }),
  )

  it.effect('a follower tab sees the status the leader writes', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const device = yield* openDevice()
      const followerDatabase: LocalDatabase = {
        ...device.database,
        role: Effect.succeed('Follower'),
      }
      const follower = yield* openReplica(followerDatabase)
      const seen = yield* recordStatuses(follower)
      const following = yield* connect(host, follower, 'tab-2')
      yield* connect(host, device.replica, 'phone')
      yield* first(follower.status, isFreshReady)
      yield* lastSeen(seen, isFreshReady)
      const current: Sync['current'] = following.sync.current
      expect((yield* current)._tag).toBe('Following')
    }),
  )

  test('a tab that takes the lead holds the rows as not fresh until it syncs', () => {
    const fresh = ScopeStatus.cases.Ready.make({ seq: 4, fresh: true })
    expect(statusAtSessionStart(fresh, 'Leading')).toEqual(
      ScopeStatus.cases.Ready.make({ seq: 4, fresh: false }),
    )
    expect(statusAtSessionStart(fresh, 'Reconnecting')).toEqual(fresh)
    const failed = ScopeStatus.cases.Failed.make({ reason: 'Forbidden' })
    expect(statusAtSessionStart(failed, 'Reconnecting')).toEqual(failed)
    expect(statusAtSessionStart(failed, 'Leading')._tag).toBe('Loading')
  })
})

describe('switching scopes', () => {
  // NOTE: a device linked while its first session connects. The session has
  // read the old scope and is opening its channel when the scope switches
  // and the sync is kicked. It must still end up on the new scope.
  it.effect(
    'a switch while a session connects moves the session to the new scope',
    () =>
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const theirs = yield* openDevice('notes:bob')
        const theirRun = yield* theirs.replica.run(Counted, {
          kind: 'runs',
          count: 7,
        })
        yield* connect(host, theirs.replica, 'bob-phone', 'bob')
        yield* settle(theirs.replica.awaitSettled(theirRun))

        const device = yield* openDevice()
        const player = yield* Ref.make(PLAYER)
        const net = yield* host.network()
        const opening = yield* Deferred.make<string>()
        const gate = yield* Deferred.make<void>()
        const gated: Transport = {
          name: net.transport.name,
          open: scope =>
            Effect.andThen(
              Effect.andThen(
                Deferred.succeed(opening, scope),
                Deferred.await(gate),
              ),
              net.transport.open(scope),
            ),
        }
        const sync = yield* syncOver(
          gated,
          device.replica,
          'laptop',
          Ref.get(player),
        )
        expect(yield* settle(Deferred.await(opening))).toBe(SCOPE)

        yield* Ref.set(player, 'bob')
        yield* device.replica.switchScope('notes:bob')
        yield* sync.reconnect
        yield* Deferred.succeed(gate, undefined)

        expect(yield* first(device.replica.status, isFreshReady)).toEqual(
          ScopeStatus.cases.Ready.make({ seq: 1, fresh: true }),
        )
      }),
  )
})

describe('awaiting a settlement', () => {
  it.effect('a pushed mutation settles as confirmed at its seq', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const device = yield* openDevice()
      yield* device.replica.run(Counted, { kind: 'runs', count: 1 })
      const id = yield* device.replica.run(Counted, {
        kind: 'runs',
        count: 2,
      })
      // NOTE: offline until the receipt watch has subscribed, so the
      // receipt cannot go out before anyone listens.
      const net = yield* host.network()
      yield* net.setOnline(false)
      const sync = yield* syncOver(net.transport, device.replica, 'phone')
      const receipt = yield* Effect.forkScoped(
        Stream.runHead(
          Stream.filter(
            sync.receipts,
            next => next._tag === 'Confirmed' && next.id === id,
          ),
        ),
        { startImmediately: true },
      )
      yield* net.setOnline(true)
      const settled = yield* settle(device.replica.awaitSettled(id))
      expect(settled).toEqual(Settled.cases.Confirmed.make({ seq: 2 }))
      expect(yield* settle(Fiber.join(receipt))).toEqual(
        Option.some({ _tag: 'Confirmed', id, seq: 2 }),
      )
    }),
  )

  it.effect('a mutation the server refuses settles as rejected', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const phone = yield* openDevice()
      const laptop = yield* openDevice()
      const claimed = yield* phone.replica.run(Claimed, {
        slot: 'crown',
        by: 'phone',
      })
      yield* connect(host, phone.replica, 'phone')
      yield* settle(phone.replica.awaitSettled(claimed))
      const second = yield* laptop.replica.run(Claimed, {
        slot: 'crown',
        by: 'laptop',
      })
      yield* connect(host, laptop.replica, 'laptop')
      const settled = yield* settle(laptop.replica.awaitSettled(second))
      expect(settled).toEqual(
        Settled.cases.Rejected.make({
          code: 'Precondition',
          reason: 'crown is taken',
        }),
      )
      expect(yield* settle(laptop.replica.awaitSettled(second))).toEqual(
        settled,
      )
    }),
  )

  it.effect('an id already settled, or never seen, answers at once', () =>
    Effect.gen(function* () {
      const device = yield* openDevice()
      const id = yield* device.replica.run(Counted, {
        kind: 'runs',
        count: 1,
      })
      yield* device.replica.receive(
        ServerMessage.cases.Acked.make({ id, seq: 0 }),
      )
      expect(yield* device.replica.pending).toHaveLength(0)
      expect(yield* device.replica.awaitSettled(id)).toEqual(
        Settled.cases.Confirmed.make({ seq: 0 }),
      )
      expect(yield* device.replica.awaitSettled('never-made-0001')).toEqual(
        Settled.cases.Confirmed.make({ seq: 0 }),
      )
    }),
  )

  it.effect(
    'a mutation made offline waits, then settles after a reconnect',
    () =>
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        const { net, sync } = yield* connect(host, device.replica, 'phone')
        yield* first(sync.status, connectionIs('Online'))
        yield* net.setOnline(false)
        yield* first(sync.status, connectionIs('Offline'))
        const id = yield* device.replica.run(Counted, {
          kind: 'runs',
          count: 5,
        })
        const waiting = yield* Effect.forkScoped(
          device.replica.awaitSettled(id),
        )
        yield* TestClock.adjust('150 millis')
        expect(waiting.pollUnsafe()).toBeUndefined()
        yield* net.setOnline(true)
        const settled = yield* settle(Fiber.join(waiting))
        expect(settled).toEqual(Settled.cases.Confirmed.make({ seq: 1 }))
      }),
  )
})
