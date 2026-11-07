# @munch/sync-engine

A small sync engine for [Effect](https://effect.website) 4. State lives in **scopes**, each with one authority. Every change is a **mutation**: a named, versioned, Schema-typed event whose apply function is plain SQL, the same statements on the client and on the server. The client applies its own mutations at once and keeps them in an outbox; the server orders them, may refuse them, and sends back what it accepted. The client then rebuilds its view from what the server confirmed and replays what is still pending.

It lives in the Munch Manor repo while the API settles, with Munch Manor's player scope as its first user, and will move to its own repo and npm package later. The name is a placeholder.

```sh
bun add @munch/sync-engine effect@^4.0.0
```

The client runs over any `effect/sql` `SqlClient`; in the browser that is [`@munch/sqlite-wasm-effect`](../sqlite-wasm-effect/README.md) (SQLite on OPFS, one leader tab). The server runs over any `SqlClient` too; on Cloudflare that is a Durable Object's SQLite through `@effect/sql-sqlite-do`. The package imports only `effect`, so one copy of the definitions serves both sides, even when they run different patch versions of Effect.

## Concepts

| Concept             | What it is                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Scope               | A piece of state with one authority, named `<kind>:<key>`, such as `player:3f9a...`. The kind picks the definition          |
| Mutation            | A name, a version, an args Schema, the scope kinds it may target, a writer policy, and a deterministic apply                |
| Writer              | `Owner` (the scope key is the writer's player id), `Members` (listed in `sync_members`), or `ServerOnly`                    |
| Readers             | Who may join a scope: `Owner`, `Members`, or `Everyone`                                                                     |
| Client mutation id  | 16 random bytes, made when the mutation runs. The server applies an id once, however often it arrives                       |
| Seq                 | The server's position for each applied mutation, per scope. A client's confirmed state is "everything up to seq N"          |
| Confirmed / view    | A client keeps two copies of each table: confirmed, which only server deltas touch, and the view the app reads              |
| Rebuild plus replay | After any server delta, ack, or rejection: copy confirmed into the view, then apply every pending mutation on top, in order |
| Read-only scope     | A scope the client only watches (a leaderboard). Deltas go straight to the view; no confirmed copy, no replay               |

## Defining a scope

```ts
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'
import {
  MutationRejected,
  defineMutation,
  defineScope,
} from '@munch/sync-engine'

export const Counted = defineMutation({
  name: 'Counted',
  version: 1,
  args: Schema.Struct({ kind: Schema.String, count: Schema.Finite }),
  scopes: ['notes'],
  writer: 'Owner',
  apply: ({ kind, count }, context) =>
    Effect.gen(function* () {
      if (count > 100) {
        return yield* MutationRejected.make({ reason: 'Too many at once' })
      }
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO ${context.table('tally')} (kind, count)
        VALUES (${kind}, ${count})
        ON CONFLICT (kind) DO UPDATE SET count = count + excluded.count`
    }),
})

export const Notes = defineScope({
  kind: 'notes',
  tables: ['tally'],
  readers: 'Owner',
  replica: 'ReadWrite',
  mutations: [Counted],
  migrations: {
    '0001_create': table =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE ${sql(table('tally'))} (kind TEXT PRIMARY KEY, count INTEGER NOT NULL)`
      }),
  },
})
```

Rules for an apply:

- **Name tables through the context.** `context.table('tally')` is `tally` on the server and in the view, and `sync_confirmed_tally` for the client's confirmed copy.
- **Be deterministic.** The same args, timestamp, and starting rows give the same rows. Read time only from `context.timestampMs` (the server's clock on the server, the moment it was made on the client) and never draw random numbers.
- **Prefer increments to totals** where two devices can change the same thing offline, so both changes count.
- **Refuse with `MutationRejected`** when a precondition does not hold. On the client that fails the `run`; on the server it becomes a `Rejected` reply and is remembered for that id.

Migrations run once per target (server, confirmed, view), in key order, recorded in `sync_migrations`. Never edit one that has shipped; add the next key.

## Client

```ts
import { makeReplica, startSync } from '@munch/sync-engine'
import { httpTransport, webSocketTransport } from '@munch/sync-engine/browser'

const replica =
  yield *
  makeReplica({
    definition: Notes,
    scope: `notes:${playerId}`,
    database: {
      sql: client.sql,
      changes: client.changes,
      role: Effect.map(client.status, s => s.role),
    },
  })

yield * replica.run(Counted, { kind: 'runs', count: 1 })

const sync =
  yield *
  startSync({
    replica,
    transports: [webSocketTransport(origin), httpTransport(origin)],
    credentials: Effect.map(identity.session, s => ({
      token: s.token,
      clientId,
    })),
    refreshCredentials: identity.invalidate,
  })
```

| `Replica`          | What it does                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `run(m, args)`     | Writes the outbox row and applies the mutation to the view in one transaction, returning its id           |
| `receive(msg)`     | Applies one server message and says what happened: `Applied`, `Resync`, `Confirmed`, `Rejected`, `Failed` |
| `pending`          | The outbox, oldest first, as protocol envelopes                                                           |
| `confirmedSeq`     | The last seq the confirmed tables hold                                                                    |
| `switchScope(id)`  | Drops this kind's tables and outbox and points it at another scope, as linking a device does              |
| `remoteChanges`    | Fires on every commit that applied something from the server, on every tab                                |
| `localChanges`     | Fires on every commit that changed the outbox, on every tab                                               |
| `status`           | The scope's `ScopeStatus` now and on every change, on every tab                                           |
| `currentStatus`    | The `ScopeStatus` now                                                                                     |
| `awaitSettled(id)` | Waits until a mutation this device made is `Confirmed { seq }` or `Rejected { code, reason }`             |
| `startSession(s)`  | Called by `startSync` as a session starts (`Leading` or `Reconnecting`); not for apps                     |

**Scope status and connection health are separate.** `ScopeStatus` says how far the replica has got with its data: `Idle` (nothing from the server, not loading), `Loading` (joining for the first time), `Ready { seq, fresh }`, or `Failed { reason }` (the server refused the scope, with `Forbidden`, `VersionMismatch`, or `BadMessage`, before it was ever ready). Rows the confirmed tables hold from an earlier session open as `Ready { fresh: false }`, so an app can show them offline; the first snapshot or deltas this session makes it `fresh: true`. Once ready, a replica stays ready: a dropped connection or a refusal shows in `Sync.status` (`Following`, `Connecting`, `Online`, `Offline`), not here. A tab that takes the lead marks its rows not fresh until its own first sync. The status lives in `sync_status`, so follower tabs read the one the leader writes.

**Awaiting a write.** `awaitSettled(id)` takes the id `run` returned. It answers at once for an id that already left the outbox: the outcome is kept in `sync_settled` (the newest 200 per kind), and an id older than that reads as `Confirmed` at the confirmed seq. It works from any tab, and offline it waits until the mutation goes out. `Sync.receipts` now carries `Confirmed { id, seq }` as well as `Rejected` and `Failed`. Switching scopes settles the dropped mutations as `Rejected { Unavailable }`.

`startSync` runs only while this tab leads (`role` is `Leader`); a follower tab writes through the leader's database, and the leader sees its outbox rows in `localChanges`. A session opens a channel, says `Hello` with the confirmed seq, applies what comes back, pushes pending mutations, re-pushes them every 15 seconds while unconfirmed, and pings every 25 seconds. Sixty seconds of silence ends it. A session that got online and then dropped reconnects at once; one that never got online waits out a jittered exponential backoff (half a second, doubling, at most 15 seconds). After two failures in a row on the first transport (the WebSocket) it tries the next (HTTP). `status` streams `Following`, `Connecting`, `Online`, or `Offline`.

## Server

```ts
import { handleRaw, makeScopeServer } from '@munch/sync-engine'

const server = yield * makeScopeServer({ definition: Notes, scope })
const handled = yield * handleRaw(server, authenticate, connection, rawMessage)
// send handled.broadcast to every joined socket of the scope, then handled.reply to this one,
// and keep handled.connection for the next message on this socket.
```

`ScopeServer` keeps `sync_log` (the applied mutations), `sync_applied` (ids it has seen, applied or rejected), `sync_head`, and `sync_members`, beside the scope's own tables. For each pushed mutation, in its own transaction: an id seen before answers as before; then the name, version, writer, and args are checked; then the apply runs, the log entry, the applied id, and the new head are written, and the log tail is trimmed. `runServer(mutation, args, id)` applies the server's own mutations the same way, with `id` as the idempotency key.

A `Hello` gets the deltas after its `lastSeq` while the log still holds them and they number at most 200; otherwise, or when it asks with `mode: 'Snapshot'`, or claims a seq past the head, it gets a snapshot of every table at the head.

The host owns the transport and authentication. `handleMessage` and `handleRaw` turn one message on one connection into a new connection state, a reply, and a broadcast. A host keeps the connection state per socket (it is small enough for a hibernating WebSocket's attachment) and handles one message at a time per scope.

## Protocol

JSON, decoded with the Schemas in `src/Protocol.ts` on both ends. `PROTOCOL_VERSION` is 1; a client on another version gets `Failed { VersionMismatch }`.

| Client to server | Fields                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `Hello`          | `protocol`, `scope`, `lastSeq`, `mode` (`Catchup` or `Snapshot`), `clientId`, `token`, `versions` |
| `Push`           | `mutations`: envelopes `{ id, name, version, args }`, args as a JSON string                       |
| `Ping`           | none                                                                                              |

| Server to client | Fields                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Snapshot`       | `scope`, `seq`, `tables`: rows per table                                                                          |
| `Deltas`         | `scope`, `head`, `deltas`: `{ seq, id, name, version, args, timestampMs, origin }`                                |
| `Acked`          | `id`, `seq`                                                                                                       |
| `Rejected`       | `id`, `code` (`UnknownMutation`, `Outdated`, `Forbidden`, `InvalidArgs`, `Precondition`, `Unavailable`), `reason` |
| `Failed`         | `code` (`Unauthorized`, `Forbidden`, `VersionMismatch`, `BadMessage`, `NotReady`, `Unavailable`), `reason`        |
| `Pong`           | none                                                                                                              |

- **Order.** A push's deltas are broadcast to every joined socket, the pusher included, before the pusher gets its acks, so a client sees its mutation confirmed before it hears it was accepted.
- **On the client.** Deltas apply to confirmed strictly in seq order: one already applied is skipped, a gap asks for a catch-up `Hello`, and a delta it cannot apply (a newer version, or one that fails) asks for a snapshot. An `Acked` the confirmed tables already hold settles the mutation; one ahead of them asks for a catch-up.
- **Heartbeat.** `PING_JSON` and `PONG_JSON` are exact strings, so a Durable Object can answer them with a WebSocket auto-response without waking.
- **HTTP fallback.** `POST /sync/exchange?scope=<id>` with an array of client messages, a `Hello` first, answers with the array of server messages a socket would have received.

## Identity and linking

No accounts. On first launch a device makes an ECDSA P-256 key pair and a random 22-character player id, kept in its own `sync_device` table. To sync:

1. `POST /sync/challenge` returns a nonce: random bytes, an expiry two minutes out, and an HMAC of both, so the server keeps no state.
2. The device signs `munch-sync-session:v1:<nonce>:<playerId>` and posts its public key, player id, nonce, and signature to `POST /sync/session`.
3. The server checks the nonce's MAC and expiry and the signature, then maps the device (the SHA-256 of its public key) to a player: a known device keeps its player; a new one registers the id it made, unless another device holds it.
4. It answers with a session token: the device id, player id, and expiry, HMAC-signed, good for a day. The `Hello` and the identity requests carry it.

A token after a challenge, rather than a signature per request, keeps each Durable Object message to a cheap HMAC check and the private key to one signature a day.

**Linking.** Device A asks `POST /sync/link` (with its token) for a code: six symbols from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0, O, 1, or I), single use, good for ten minutes, one live code per player. Device B posts it to `POST /sync/link/redeem` with its own token. The server maps B's device to A's player and returns a new token; B calls `switchScope`, dropping its own player's data, and joins A's scope with a snapshot. Five wrong, expired, or malformed codes lock a device out of redeeming for ten minutes, and the edge rate limits identity requests per address.

`makeDeviceIdentity({ sql, api })` is the client side and `makeDirectory(secret)` the server side; `IdentityApi` is the seam between them (`httpIdentityApi(origin)` in the browser).

## Limits

- **One instance per scope kind on a client.** Tables are named by kind, so a client mirrors one `player` scope at a time. Two leaderboards would need per-instance table names.
- **No blobs or bigints in snapshots.** Snapshot rows carry null, numbers, and strings.
- **No cross-scope outbox.** A server mutation in another scope is made by calling that scope's server; Munch Manor does this by hand for the linked device count. A failed call is not retried.
- **Applied ids are kept for the last 20,000 seqs.** A mutation retried after more than that many others in its scope could apply twice.
- **A snapshot can briefly double a pending mutation** that the server applied but whose delta the client missed: the view shows it twice until its ack (which comes on the next push) settles it.
- **The private key is stored extractable** as a JWK in SQLite and imported non-extractable on each load. SQLite cannot hold a `CryptoKey`; IndexedDB could, at the cost of a second store.
- **Replaying a captured session request** within its two-minute nonce window would mint a token for that device. Requests go over TLS; a single-use nonce store would close this.
- **Linking replaces the joining device's progress** with the other device's. Merging two players is not supported.
- **Rooms with real conflicts** are untested: Munch Manor only ships the player scope so far.

## Files

| File               | What it holds                                                                  |
| ------------------ | ------------------------------------------------------------------------------ |
| `src/Mutation.ts`  | Mutations, writers, actors, the apply context, and the table naming per target |
| `src/Scope.ts`     | Scope ids, scope definitions, migrations per target, and permission checks     |
| `src/Protocol.ts`  | The wire Schemas and their JSON codecs                                         |
| `src/Server.ts`    | `ScopeServer`, the log, dedupe, snapshots, compaction, and the host's handler  |
| `src/Replica.ts`   | The client: outbox, confirmed and view tables, rebuild plus replay             |
| `src/Sync.ts`      | Transports, channels, the sync loop, backoff, heartbeat, and status            |
| `src/Identity.ts`  | Device keys, signatures, challenges, tokens, and the identity request Schemas  |
| `src/Pairing.ts`   | Link codes and the rules for wrong tries, as pure functions                    |
| `src/Directory.ts` | The server's devices, players, and link codes over any `SqlClient`             |
| `src/Device.ts`    | The client's key pair, player id, and session token                            |
| `src/Browser.ts`   | The WebSocket and HTTP transports and the HTTP identity client                 |
| `src/InProcess.ts` | An in-process host and a seeded fake network, for tests                        |

## Tests

`bun run test` in this folder (the repo's `bun run test` runs them too), in Node over sqlite-wasm's in-memory databases: one per client and one per scope on the in-process host. They cover rebuild plus replay, duplicate and out of order deltas, rejections, idempotency, permissions, unknown names and versions, server mutations, snapshot joins and log trimming, two devices converging under a seeded network that drops (closing the connection), duplicates, and reorders messages with one of them offline for a while and a slot both claim, follower tabs, the pairing rules, tokens and keys, linking end to end through a Directory, and the protocol codecs.
