import {
  Array,
  Effect,
  Exit,
  Option,
  Order,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from 'effect'
import type { SqlClient, SqlError } from 'effect/sql'

import { describe, expect, it } from '@effect/vitest'

import { type Host, type NetworkOptions, makeHost } from '../src/InProcess'
import { startSync } from '../src/Sync'
import { first, settle } from '../src/Testing'
import {
  Actor,
  type Envelope,
  type LocalDatabase,
  type Replica,
  ServerMessage,
  encodeArgs,
  makeReplica,
} from '../src/index'
import {
  Claimed,
  Counted,
  FAST_TIMING,
  Notes,
  PLAYER,
  Renamed,
  SCOPE,
  Stamped,
  authenticate,
  openClientDatabase,
  openServerDatabase,
} from './fixtures'

const Tally = Schema.Struct({ kind: Schema.String, count: Schema.Number })
const Profile = Schema.Struct({
  name: Schema.String,
  stamped_ms: Schema.Number,
})
const Slot = Schema.Struct({ slot: Schema.String, by: Schema.String })

const State = Schema.Struct({
  profile: Schema.Array(Profile),
  tally: Schema.Array(Tally),
  slots: Schema.Array(Slot),
})
type State = typeof State.Type

const readState = (
  sql: SqlClient.SqlClient,
  prefix = '',
): Effect.Effect<State> =>
  Effect.orDie(
    Effect.gen(function* () {
      const profile =
        yield* sql`SELECT name, stamped_ms FROM ${sql(`${prefix}profile`)}`
      const tally =
        yield* sql`SELECT kind, count FROM ${sql(`${prefix}tally`)} ORDER BY kind`
      const slots =
        yield* sql`SELECT slot, by FROM ${sql(`${prefix}slots`)} ORDER BY slot`
      return yield* Schema.decodeUnknownEffect(State)({ profile, tally, slots })
    }),
  )

interface Device {
  readonly database: LocalDatabase
  readonly replica: Replica
}

const openDevice = (
  scope = SCOPE,
): Effect.Effect<Device, SqlError.SqlError, Scope.Scope> =>
  Effect.gen(function* () {
    const database = yield* openClientDatabase
    const replica = yield* makeReplica({ definition: Notes, database, scope })
    return { database, replica }
  })

const connect = (
  host: Host,
  device: Device,
  deviceId: string,
  network: NetworkOptions = {},
  playerId = PLAYER,
) =>
  Effect.gen(function* () {
    const net = yield* host.network(network)
    const sync = yield* startSync({
      replica: device.replica,
      transports: [net.transport],
      credentials: Effect.succeed({
        token: `${deviceId}:${playerId}`,
        clientId: deviceId,
      }),
      ...FAST_TIMING,
    })
    return { net, sync }
  })

const makeTestHost = (
  options: { logTail?: number; snapshotAfter?: number } = {},
) =>
  makeHost({
    definitions: [Notes],
    openDatabase: () => openServerDatabase,
    authenticate,
    ...options,
  })

// NOTE: waits until every device has nothing pending and has confirmed
// the server's head. Every test runs on it.effect's TestClock: settle
// moves it, so the network's delays, heartbeats, and resends elapse only as
// the test waits, and a loaded machine cannot time a session out.
const settled = (host: Host, devices: ReadonlyArray<Device>) =>
  settle(
    Effect.gen(function* () {
      const server = yield* host.server(SCOPE)
      const head = yield* server.head
      const states = yield* Effect.forEach(devices, device =>
        Effect.all([device.replica.pending, device.replica.confirmedSeq]),
      )
      return Array.every(
        states,
        ([pending, confirmed]) =>
          Array.isReadonlyArrayEmpty(pending) && confirmed === head,
      )
    }).pipe(
      Effect.orDie,
      Effect.repeat({
        until: done => done,
        schedule: Schedule.spaced('20 millis'),
      }),
    ),
  )

const serverState = (host: Host) =>
  Effect.gen(function* () {
    const server = yield* host.server(SCOPE)
    const snapshot = yield* server.snapshot
    return snapshot
  }).pipe(Effect.orDie)

const viewOf = (device: Device) => readState(device.database.sql)

const tallyOf = (state: State, kind: string): number =>
  Option.match(
    Array.findFirst(state.tally, row => row.kind === kind),
    { onNone: () => 0, onSome: row => row.count },
  )

describe('rebuild plus replay', () => {
  it.effect('a pending mutation stays on top of deltas from elsewhere', () =>
    Effect.gen(function* () {
      const device = yield* openDevice()
      yield* device.replica.run(Counted, { kind: 'runs', count: 2 })
      const fromElsewhere = yield* encodeArgs(Counted, {
        kind: 'runs',
        count: 3,
      })
      const receipt = yield* device.replica.receive(
        ServerMessage.cases.Deltas.make({
          scope: SCOPE,
          head: 1,
          deltas: [
            {
              seq: 1,
              id: 'other-device-0001',
              name: 'Counted',
              version: 1,
              args: fromElsewhere,
              timestampMs: 5,
              origin: 'Client',
            },
          ],
        }),
      )
      expect(receipt._tag).toBe('Applied')
      const view = yield* viewOf(device)
      const confirmed = yield* readState(device.database.sql, 'sync_confirmed_')
      expect(tallyOf(view, 'runs')).toBe(5)
      expect(tallyOf(confirmed, 'runs')).toBe(3)
      expect(yield* device.replica.pending).toHaveLength(1)
      expect(yield* device.replica.confirmedSeq).toBe(1)
    }),
  )

  it.effect('duplicated and out of order deltas apply once, in order', () =>
    Effect.gen(function* () {
      const device = yield* openDevice()
      const args = yield* encodeArgs(Counted, { kind: 'runs', count: 1 })
      const delta = (seq: number) => ({
        seq,
        id: `delta-${seq}-aaaaaa`,
        name: 'Counted',
        version: 1,
        args,
        timestampMs: seq,
        origin: 'Client' as const,
      })
      const gap = yield* device.replica.receive(
        ServerMessage.cases.Deltas.make({
          scope: SCOPE,
          head: 2,
          deltas: [delta(2)],
        }),
      )
      expect(gap).toEqual({ _tag: 'Resync', mode: 'Catchup' })
      yield* device.replica.receive(
        ServerMessage.cases.Deltas.make({
          scope: SCOPE,
          head: 3,
          deltas: [delta(3), delta(1), delta(2), delta(1)],
        }),
      )
      const view = yield* viewOf(device)
      expect(tallyOf(view, 'runs')).toBe(3)
      expect(yield* device.replica.confirmedSeq).toBe(3)
    }),
  )

  it.effect('a rejection drops the mutation and rebuilds the view', () =>
    Effect.gen(function* () {
      const device = yield* openDevice()
      const id = yield* device.replica.run(Claimed, { slot: 'x', by: 'me' })
      expect((yield* viewOf(device)).slots).toHaveLength(1)
      const receipt = yield* device.replica.receive(
        ServerMessage.cases.Rejected.make({
          id,
          code: 'Precondition',
          reason: 'x is taken',
        }),
      )
      expect(receipt._tag).toBe('Rejected')
      expect((yield* viewOf(device)).slots).toHaveLength(0)
      expect(yield* device.replica.pending).toHaveLength(0)
    }),
  )

  it.effect('a mutation that fails locally never reaches the outbox', () =>
    Effect.gen(function* () {
      const device = yield* openDevice()
      const exit = yield* Effect.exit(
        device.replica.run(Counted, { kind: 'runs', count: 500 }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* device.replica.pending).toHaveLength(0)
      expect((yield* viewOf(device)).tally).toHaveLength(0)
    }),
  )
})

describe('the server', () => {
  const envelope = (id: string, count: number) =>
    Effect.map(
      encodeArgs(Counted, { kind: 'runs', count }),
      (args): Envelope => ({ id, name: 'Counted', version: 1, args }),
    )

  it.effect('applies a mutation id once, however often it arrives', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const server = yield* host.server(SCOPE)
      const owner = Actor.cases.Device.make({
        playerId: PLAYER,
        deviceId: 'a',
      })
      const once = yield* envelope('mutation-0001', 4)
      const firstTry = yield* server.push(owner, [once, once])
      const again = yield* server.push(owner, [once])
      expect(firstTry.deltas).toHaveLength(1)
      expect(again.deltas).toHaveLength(0)
      expect(again.replies).toEqual([
        { _tag: 'Acked', id: 'mutation-0001', seq: 1 },
      ])
      const snapshot = yield* server.snapshot
      expect(snapshot._tag === 'Snapshot' && snapshot.tables['tally']).toEqual([
        { kind: 'runs', count: 4 },
      ])
    }),
  )

  it.effect(
    'refuses writers without permission, unknown names, and old versions',
    () =>
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const server = yield* host.server(SCOPE)
        const stranger = Actor.cases.Device.make({
          playerId: 'bo',
          deviceId: 'b',
        })
        const owner = Actor.cases.Device.make({
          playerId: PLAYER,
          deviceId: 'a',
        })
        const counted = yield* envelope('mutation-0002', 1)
        const stamped = yield* Effect.map(
          encodeArgs(Stamped, {}),
          (args): Envelope => ({
            id: 'mutation-0003',
            name: 'Stamped',
            version: 1,
            args,
          }),
        )
        const result = yield* server.push(stranger, [counted])
        const serverOnly = yield* server.push(owner, [stamped])
        const unknown = yield* server.push(owner, [
          { ...counted, id: 'mutation-0004', name: 'Nope' },
          { ...counted, id: 'mutation-0005', version: 9 },
          { ...counted, id: 'mutation-0006', args: '{"kind":1}' },
        ])
        expect(Array.map(result.replies, reply => reply._tag)).toEqual([
          'Rejected',
        ])
        expect(serverOnly.replies[0]).toMatchObject({ code: 'Forbidden' })
        expect(
          Array.map(
            unknown.replies,
            reply => reply._tag === 'Rejected' && reply.code,
          ),
        ).toEqual(['UnknownMutation', 'Outdated', 'InvalidArgs'])
        expect(yield* server.head).toBe(0)
        const outsider = yield* server.checkRead(stranger)
        expect(outsider._tag).toBe('Forbidden')
      }),
  )

  it.effect('runs its own mutations with its own clock, idempotently', () =>
    Effect.gen(function* () {
      const host = yield* makeTestHost()
      const server = yield* host.server(SCOPE)
      const firstTry = yield* server.runServer(Stamped, {}, 'server-stamp-1')
      const again = yield* server.runServer(Stamped, {}, 'server-stamp-1')
      expect(firstTry._tag).toBe('Applied')
      expect(again._tag).toBe('Duplicate')
      expect(yield* server.head).toBe(1)
    }),
  )

  it.effect(
    'a far behind client joins with a snapshot, and the log is trimmed',
    () =>
      Effect.gen(function* () {
        const host = yield* makeTestHost({ logTail: 3, snapshotAfter: 3 })
        const server = yield* host.server(SCOPE)
        const owner = Actor.cases.Device.make({
          playerId: PLAYER,
          deviceId: 'a',
        })
        const envelopes = yield* Effect.forEach(Array.range(1, 10), n =>
          envelope(`mutation-${String(n).padStart(4, '0')}`, n),
        )
        yield* server.push(owner, envelopes)
        const fresh = yield* server.join({ lastSeq: 0, mode: 'Catchup' })
        const recent = yield* server.join({ lastSeq: 8, mode: 'Catchup' })
        expect(fresh._tag).toBe('Snapshot')
        expect(
          recent._tag === 'Deltas' && Array.map(recent.deltas, d => d.seq),
        ).toEqual([9, 10])
        const device = yield* openDevice()
        yield* device.replica.receive(fresh)
        expect(tallyOf(yield* viewOf(device), 'runs')).toBe(55)
        expect(yield* device.replica.confirmedSeq).toBe(10)
        const trimmed = yield* server.join({ lastSeq: 6, mode: 'Catchup' })
        expect(trimmed._tag).toBe('Snapshot')
      }),
  )
})

describe('convergence over a bad network', () => {
  const scenario = (seed: number) =>
    Effect.gen(function* () {
      const host = yield* makeTestHost({ logTail: 8, snapshotAfter: 6 })
      const phone = yield* openDevice()
      const laptop = yield* openDevice()
      const flaky: NetworkOptions = {
        seed,
        drop: 0.08,
        duplicate: 0.2,
        maxDelayMs: 6,
      }
      const onPhone = yield* connect(host, phone, 'phone', flaky)
      const onLaptop = yield* connect(host, laptop, 'laptop', {
        ...flaky,
        seed: seed + 1,
      })

      yield* Effect.forEach(Array.range(1, 12), n =>
        Effect.andThen(
          phone.replica.run(Counted, {
            kind: n % 2 === 0 ? 'even' : 'odd',
            count: n,
          }),
          laptop.replica.run(Counted, { kind: 'laptop', count: 1 }),
        ),
      )

      yield* onLaptop.net.setOnline(false)
      yield* Effect.forEach(Array.range(1, 15), n =>
        laptop.replica.run(Counted, { kind: 'offline', count: n }),
      )
      yield* laptop.replica.run(Claimed, { slot: 'crown', by: 'laptop' })
      yield* laptop.replica.run(Renamed, { name: 'From the laptop' })
      yield* phone.replica.run(Claimed, { slot: 'crown', by: 'phone' })
      yield* phone.replica.run(Renamed, { name: 'From the phone' })
      yield* settled(host, [phone])
      yield* onLaptop.net.setOnline(true)

      yield* settled(host, [phone, laptop])
      const server = yield* serverState(host)
      const phoneView = yield* viewOf(phone)
      const laptopView = yield* viewOf(laptop)
      const laptopConfirmed = yield* readState(
        laptop.database.sql,
        'sync_confirmed_',
      )
      expect(phoneView).toEqual(laptopView)
      expect(laptopConfirmed).toEqual(laptopView)
      const serverTally =
        server._tag === 'Snapshot'
          ? Array.sort(
              yield* Schema.decodeUnknownEffect(Schema.Array(Tally))(
                server.tables['tally'],
              ),
              Order.mapInput(
                Order.String,
                (row: typeof Tally.Type) => row.kind,
              ),
            )
          : []
      expect(serverTally).toEqual(laptopView.tally)
      expect(tallyOf(laptopView, 'odd')).toBe(1 + 3 + 5 + 7 + 9 + 11)
      expect(tallyOf(laptopView, 'even')).toBe(2 + 4 + 6 + 8 + 10 + 12)
      expect(tallyOf(laptopView, 'laptop')).toBe(12)
      expect(tallyOf(laptopView, 'offline')).toBe(120)
      expect(laptopView.slots).toEqual([{ slot: 'crown', by: 'phone' }])
      expect(laptopView.profile[0]?.name).toBe('From the laptop')
      const phoneFaults = yield* onPhone.net.faults
      const laptopFaults = yield* onLaptop.net.faults
      expect(phoneFaults.dropped + laptopFaults.dropped).toBeGreaterThan(0)
      expect(phoneFaults.duplicated + laptopFaults.duplicated).toBeGreaterThan(
        0,
      )
    })

  it.effect(
    'two devices, drops, duplicates, reorders, and a long offline spell',
    () => scenario(7),
  )

  it.effect('the same with another seed', () => scenario(42))

  it.effect(
    'a stranger cannot join, and a follower tab leaves syncing to the leader',
    () =>
      Effect.gen(function* () {
        const host = yield* makeTestHost()
        const device = yield* openDevice()
        const stranger = yield* connect(host, device, 'evil', {}, 'mallory')
        const receipt = yield* stranger.sync.receipts.pipe(
          Stream.take(1),
          Stream.runHead,
        )
        expect(receipt).toMatchObject({
          value: { _tag: 'Failed', code: 'Forbidden' },
        })
        const follower: Device = {
          database: { ...device.database, role: Effect.succeed('Follower') },
          replica: { ...device.replica, role: Effect.succeed('Follower') },
        }
        const following = yield* connect(host, follower, 'tab-2')
        const status = yield* first(
          following.sync.status,
          current => current._tag === 'Following',
        )
        expect(status._tag).toBe('Following')
      }),
  )
})
