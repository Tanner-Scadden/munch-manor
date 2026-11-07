# @munch/sqlite-wasm-effect

SQLite in the browser for [Effect](https://effect.website) 4. It runs [`@sqlite.org/sqlite-wasm`](https://github.com/sqlite/sqlite-wasm) in a dedicated Web Worker on the `opfs-sahpool` VFS and gives the main thread a standard `effect/sql` `SqlClient`, so app code writes `` sql`SELECT ...` `` as it would against any other Effect SQL driver.

It lives in the Munch Manor repo while the API settles, and will move to its own repo and npm package with a public name later. The name here is a placeholder.

## Install

```sh
bun add @munch/sqlite-wasm-effect effect@4.0.6
```

`@sqlite.org/sqlite-wasm` is pinned to `3.54.1-build1`. `effect` is a peer dependency.

## Usage

The worker entry is one file in your app, so your bundler builds it:

```ts
// src/sqlite.worker.ts
import { runWorker } from '@munch/sqlite-wasm-effect/worker'

runWorker()
```

Then provide the layer on the main thread:

```ts
import { Browser, SqliteClient } from '@munch/sqlite-wasm-effect'
import { Effect, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

const SqliteLive = Browser.layer({
  worker: () =>
    new Worker(new URL('./sqlite.worker.ts', import.meta.url), {
      type: 'module',
    }),
  name: 'my-app',
})

const Todo = Schema.Struct({ id: Schema.Finite, title: Schema.String })

const program = Effect.gen(function* () {
  const client = yield* SqliteClient
  const sql = yield* SqlClient.SqlClient

  yield* client.migrate({
    '0001_create_todos': Effect.asVoid(
      sql`CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL)`,
    ),
  })

  yield* client.transaction(
    sql`INSERT INTO todos ${sql.insert({ id: 1, title: 'Water the plants' })}`,
  )

  return yield* client.query(Todo, sql`SELECT id, title FROM todos`)
})

Effect.runPromise(Effect.provide(program, SqliteLive))
```

### Vite

Leave `@sqlite.org/sqlite-wasm` out of dependency pre-bundling, since it finds `sqlite3.wasm` beside itself with `new URL(..., import.meta.url)`, and build workers as ES modules:

```ts
export default defineConfig({
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
})
```

No COOP or COEP headers are needed. Serve `.wasm` as `application/wasm` (Vite, Cloudflare static assets, and most hosts do).

## API

`Browser.layer(options)` provides two services:

- **`SqlClient.SqlClient`** from `effect/sql`: the `sql` tagged template, `sql.insert`, `withTransaction` (with savepoints for nested transactions), `reactive`, and everything else built on it, such as `SqlSchema`, `SqlResolver`, and `SqlModel`.
- **`SqliteClient`**, a small layer of conveniences over it:
  - `execute(statement)` runs a statement for its effect.
  - `query(schema, statement)` decodes every row with a Schema, failing with `SchemaError` on a mismatch.
  - `transaction(effect)` is `sql.withTransaction`: commit on success, roll back on any failure or interruption.
  - `migrate(migrations)` runs `effect/sql`'s `Migrator` over a record keyed `<id>_<name>`. Migrations run once each, in id order, inside one transaction, and are recorded in `effect_sql_migrations`.
  - `status` is `{ role, persistence }`.
  - `changes` is a stream of the tables each commit changed.

Options: `worker` (a factory for the worker), `name` (used for the lock, the channel, and the OPFS directory `.<name>`; default `sqlite-wasm-effect`), `file` (default `/main.sqlite3`), `openTimeout` (default 60 seconds, the wasm has to download first), and `requestTimeout` (default 30 seconds).

Errors are typed. Statements fail with `effect/sql`'s `SqlError`, its reason classified from the SQLite result code: `UniqueViolation`, `ConstraintError`, `LockTimeoutError`, `ConnectionError`, `StatementTimeoutError`, or else `UnknownError`, always with SQLite's message. Opening fails with `SqliteOpenError`. Parameters may be `null`, numbers, strings, bigints, `Uint8Array`, booleans (stored as 1 or 0), and `Date` (stored as an ISO string); anything else fails before it is sent.

`@munch/sqlite-wasm-effect/in-process` runs the same worker code in the current thread on an in-memory database, through the same Schema protocol. `makeHub()` gives one database and a `layer()` per session, which is how the tests run two "tabs" in Node.

## Persistence

| Where                                                                    | Persistence                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Chrome and Edge 108+, Firefox 111+, Safari 16.4+ (desktop and iOS)       | `Opfs`: the database file lives in the origin private file system                                |
| Firefox private windows, browsers without `createSyncAccessHandle`, Node | `Memory`, with a `reason`: the database lasts as long as the leader tab                          |
| Safari private windows                                                   | Not verified: `Opfs` if Safari allows it there, cleared when the window closes, or else `Memory` |

`status.persistence` says which one you got. An app that must not lose data should keep its own fallback when it sees `Memory`, as Munch Manor keeps writing its old localStorage copy.

When OPFS is there but its files are still held by another context, such as a tab that is reloading, opening retries for about two seconds before it gives up on OPFS.

## One leader tab

`opfs-sahpool` allows one connection to the file at a time, so one tab leads:

1. Each tab asks for the Web Lock `<name>:leader`. The tab that gets it starts the worker and opens the file.
2. Every other tab is a follower. It sends its requests to the leader over the BroadcastChannel `<name>:channel`, and the leader forwards them to its worker and posts the answers back. Followers keep waiting in line for the lock.
3. When the leader tab closes, the browser frees the lock, the next tab in line starts its own worker, opens the same file, and announces itself. Calls the other followers had in flight fail at once with a `ConnectionError`, and they carry on with the new leader.

The worker gives each tab its own session. A session that opens a transaction holds the database until it commits or rolls back; statements from other tabs wait in line, so transactions never interleave. A transaction left idle for 10 seconds, as by a tab that closed mid-way, is rolled back. A follower that closes also releases its session at once.

A browser without Web Locks leads on its own with no guard between tabs. Every browser with `opfs-sahpool` has Web Locks.

## Limits

- One database file per `name`. Open two names for two databases.
- Statements are sent one at a time; a large import is faster as a single multi-row `INSERT` inside a transaction.
- `changes` only sees rowid tables, not `WITHOUT ROWID` ones, and follows SQLite's update hook: a `DELETE` without a `WHERE` that SQLite truncates may not report rows.
- `sql.stream` reads the whole result first; rows are not streamed from the worker.
- No WAL: `opfs-sahpool` uses the rollback journal.
- A follower's calls go through the leader's worker, so they wait behind the leader's transactions.

## Extension points

Built for the sync engine that comes next:

- **Outbox in the same transaction.** Wrap the mutation and its outbox row in one `client.transaction(...)`. Both commit, or neither does.
- **Change hooks.** `client.changes` emits the tables of every commit, on every tab, once the commit is durable. Rolled back writes never appear. `sql.reactive([table], query)` reruns a query when its table changes.
- **Transports.** `Server` (`src/Server.ts`) is the worker side and `Remote` (`src/Remote.ts`) the main thread side of one Schema protocol (`src/Protocol.ts`). Either can run over another transport, as `inProcess.ts` does.

## Files

| File                  | What it holds                                                               |
| --------------------- | --------------------------------------------------------------------------- |
| `src/Protocol.ts`     | The Schema messages between tabs, the main thread, and the worker           |
| `src/Engine.ts`       | The database itself: opening on OPFS or in memory, statements, change hooks |
| `src/Server.ts`       | The worker side: one request at a time, sessions, idle rollback             |
| `src/worker.ts`       | `runWorker`, the worker entry                                               |
| `src/Remote.ts`       | The main thread side: ids, timeouts, cancellation, swapping the route       |
| `src/SqliteClient.ts` | The `SqlClient`, the `SqliteClient` service, opening, and migrations        |
| `src/Browser.ts`      | The browser layer: the leader lock, the channel, and the worker             |
| `src/inProcess.ts`    | The same server in this thread, for tests and Node                          |

## Tests

`bun run test` in this folder (the repo's `bun run test` runs them too). They run in Node on sqlite-wasm's in-memory database through the in-process hub: the protocol, typed errors, Schema-decoded queries, transactions, migrations, change notifications, and two sessions taking turns. The browser path is checked end to end by `tools/audit/sqlite.ts` in the Munch Manor repo.
