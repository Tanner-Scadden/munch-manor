# Spike: player sync on `effect/eventlog`

Mastery (hero points, gun kills) synced with Effect's own EventLog, with no code from `@munch/sync-engine`.

| File             | What it is                                                                                                                                                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mastery.ts`     | The `GainedMastery` event (keyed by run id) and its handler, an add-only SQL projection the client and server share                                                                                                                          |
| `serverParts.ts` | Owner-only authorization (store `player:<publicKey>`), a store mapping that pins a store to its Durable Object, the server's handlers                                                                                                         |
| `device.ts`      | A device: `SqlEventJournal` and the projection on one SQLite, `EventLogRemote.layerUnencrypted` over a WebSocket with `RpcSerialization.layerSchemaBinary`                                                                                  |
| `server.ts`      | `EventLogServerUnencrypted` on Bun's HTTP server, for `run.ts`                                                                                                                                                                               |
| `doProtocol.ts`  | An `RpcServer.Protocol` over a Durable Object's hibernation WebSockets, a port of Alchemy's `RpcWebSocket` (Apache-2.0) to a plain DO class and any serializer. A socket that wakes with a request open is closed 1012 so its client resubscribes |
| `worker.ts`      | The `EventLogStore` Durable Object: `EventLogServerUnencrypted.layerNoRpcServer` on `SqlEventLogServerUnencrypted` over `@effect/sql-sqlite-do`, one object per player store                                                                |
| `run.ts`         | Bun end to end: `bun spike/eventlog/run.ts`                                                                                                                                                                                                   |
| `runDo.ts`       | The same against the Durable Object in local workerd: `bun spike/eventlog/runDo.ts` (`IDLE_SECONDS=40` to idle longer)                                                                                                                       |

## What passed (both runs)

- Two devices write offline, go online, and both end with the summed mastery; the server's projection matches.
- A write made while the server is down (Bun server stopped, or workerd killed) reaches the other device once it is back.
- A device reloaded from its SQLite keeps its journal and counts nothing twice, online again too.
- Another identity cannot write or read a player's store, even on that store's socket; a store sent to the wrong Durable Object is refused.

## What we found

- EventLog needs binary RPC (`Transferable.Uint8Array` payloads). Alchemy's `RpcDurableObject` is JSON only and runs in Alchemy's own Worker runtime, so we keep a small protocol of our own (`doProtocol.ts`, 160 lines) around Effect's `RpcServer`.
- EventLog's `changes` feed is a request that never ends, so a hibernated object cannot keep it. A socket that wakes with it open is closed 1012 and the client resubscribes from its cursor. Local workerd never hibernated in 40 s idle, so the wake path is untested until a preview deploy.
- A server handler failure fails the whole write batch with no per-entry rejection and no rollback on the client: handlers must accept everything and merge (increments, max, union).
- A refused read surfaces as `ProtocolError: Decoding failure` (the server's `changes` maps any failure to it), and a refused client retries forever. Worth an upstream issue.
- Shutting a Bun server down waits about 20 s on open sockets; the Durable Object path does not.
