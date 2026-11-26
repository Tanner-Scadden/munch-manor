# Spike: player sync on `effect/eventlog`

Mastery (hero points, gun kills) synced with Effect's own EventLog, with no code from `@munch/sync-engine`.

The spike's code is gone: it shipped as the player log. Its files live on in the commits before the move (`git log -- infra/spike/eventlog`), and their production versions are:

| Spike file       | Now                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `mastery.ts`     | `src/platform/save/playerEvents.ts` and `src/platform/save/playerProjection.ts`, the whole save                                    |
| `serverParts.ts` | `infra/worker/playerLogCore.ts`: owner-only authorization, the store pinned to its object, the handlers, `Session.*`     |
| `doProtocol.ts`  | `infra/worker/doProtocol.ts`                                                                                              |
| `worker.ts`      | `infra/worker/playerLog.ts`, the `PlayerLog` Durable Object                                                              |
| `device.ts`      | the client's store in `src/platform/`                                                                                     |
| `run.ts`, `runDo.ts`, `server.ts`, `alchemy.run.ts` | `infra/worker/playerLog.test.ts` and the main deploy                                                   |

## What passed (both runs)

- Two devices write offline, go online, and both end with the summed mastery; the server's projection matches.
- A write made while the server is down (Bun server stopped, or workerd killed) reaches the other device once it is back.
- A device reloaded from its SQLite keeps its journal and counts nothing twice, online again too.
- Another identity cannot write or read a player's store, even on that store's socket; a store sent to the wrong Durable Object is refused.

## What we found

- EventLog needs binary RPC (`Transferable.Uint8Array` payloads). Alchemy's `RpcDurableObject` is JSON only and runs in Alchemy's own Worker runtime, so we keep a small protocol of our own (`doProtocol.ts`, 160 lines) around Effect's `RpcServer`.
- EventLog's `changes` feed is a request that never ends, so a hibernated object cannot keep it. A socket that wakes with it open is closed 1012 and the client resubscribes from its cursor. On a real deploy (`alchemy.run.ts`, stage `eventlog`) this works: after 400 s idle the object came back as a new instance and a write still reached the other device.
- Two things keep the object awake, so it never hibernates as written:
  - **The client's ping.** `RpcClient` pings every 5 s by default. Its pings are binary frames, so `setWebSocketAutoResponse` cannot answer them and each one wakes the object. A longer `pingInterval` lets it sleep, but then every ping wakes it and forces the 1012 resubscribe.
  - **The store's PubSub.** `SqlEventLogServerUnencrypted` caches each store's PubSub in an `RcMap` with a fixed 5 minute `idleTimeToLive`, so a write arms a 5 minute timer and a pending timer blocks hibernation. No option changes it.
- JSON RPC (`RpcSerialization.layerJson`, which a text ping auto-response would need) fails on EventLog's auth challenge: `Expected Uint8Array at ["value"]["challenge"]`.
- **Resume on wake works on the deploy.** With a 60 s client ping and 400 s idle, the object hibernated and woke at least twice, resumed both devices' `changes` subscriptions (`resumed=2`), closed no socket, and a write after the idle reached the other device. How:
  - The attachment keeps each open `changes` request as it arrived (its payload still bytes) and the public key once `Authenticate` succeeds. On wake the protocol hands the requests to `RpcServer` again under their own ids.
  - Sign-in lives in memory on `RpcServer`'s client (`EventLogServer.AuthenticatedIdentities`), and `changes` checks it inside its handler, before any middleware runs. So the worker wraps every EventLog handler to restore a woken client's key first. The key was proven by a signature before it was saved.
  - With schema-binary, a request's payload and a reply's exit are bytes, each encoded by its RPC's own codec. The protocol decodes `Authenticate`'s with `codecFor(rpc.payloadSchema)` and `codecFor(Rpc.exitSchema(rpc))`, as `RpcServer` does.
  - A resumed feed starts again from the sequence it first asked for, so a device may receive entries it has; the journal drops them by id. A feed open for weeks would want its cursor kept as it advances.
- Still awake: the client must ping a minute or more apart (each ping wakes the object briefly), and a write holds it awake 5 minutes for the `RcMap`. An upstream option for that time to live would cut the floor.
- A server handler failure fails the whole write batch with no per-entry rejection and no rollback on the client: handlers must accept everything and merge (increments, max, union).
- A refused read surfaces as `ProtocolError: Decoding failure` (the server's `changes` maps any failure to it), and a refused client retries forever. Worth an upstream issue.
- Shutting a Bun server down waits about 20 s on open sockets; the Durable Object path does not.

## Sketch: the whole save on EventLog

Two kinds of data, two tools. What a player **sets** is an `EventRow`: `set`, `patch`, and `remove`, its conflicts settled per top-level field, so a hat changed on the phone and a shirt changed on the laptop both survive. What a player **earns** is a plain event keyed so a replay counts once, its handler a merge that order cannot change (add, max, min, union, first kept).

### Rows (`EventRow`, last write wins per field)

| Row             | Key       | Fields (today's `PlayerSave`)                                                                                    |
| --------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `profile`       | `"me"`    | `name`, `calling`, `appearance` (each part its own field, so two parts change apart)                            |
| `settings`      | `"me"`    | `settings.*`, `rotation`, `rumble`, `recordRuns`, `homeScreenTip`, `difficulty.chosen`                          |
| `seen`          | `"me"`    | `home.seenNewsDay`, `home.turnHintSeen`, `difficulty.card`, `onboarding.trapHint`, `onboarding.intro`           |
| `lesson`        | lesson id | one row per lesson: `Pending` or `Learned` (a patch per lesson, so two devices learning two lessons both keep them) |

Nested structs go flat: `EventRow` resolves top-level fields only, so a struct kept whole would lose one device's change to another's.

### Events (merges, keyed so each counts once)

| Event                | Primary key            | Handler                                                                                     | Today                                   |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| `EndedRun`           | run id                 | adds `runsPlayed`, `totalKills`, `killsByKind`, rank points and Bones earned; mins and maxes the bests and records | `EndedRun`, `RecordedRun`, `ReachedRecords`, `EarnedRank` |
| `GainedMastery`      | run id                 | adds hero points and gun kills (this spike)                                                 | `GainedMastery`                         |
| `ShelvedProof`       | thing + difficulty     | keeps the first stamp: skip when `conflicts` holds an older one                             | `ShelvedProof`                          |
| `ClimbedDareLadder`  | difficulty             | max                                                                                          | `ClimbedDareLadder`                     |
| `FoundInJournal`     | run id                 | union of rooms, heroes, things, milestones                                                  | the journal's increments                |
| `BoughtCosmetic`     | cosmetic id            | spends its price once: skip when `conflicts` holds the same id, so two devices buying offline pay once | `BoughtCosmetic`                        |
| `RolledMissions`, `ProgressedMission`, `RerolledMission`, `ClaimedMission` | day, day + slot | the day's roll from the day alone; progress max; one reroll a day (first kept); a claim pays once | the mission scope                       |
| `Saw`                | unlock or entry id     | union (`seenUnlocks`, `seenPowerUps`, `home.openedEntries`, `onboarding.introducedKinds`)   | `SawUnlocks`, `SawPowerUps`, `ChangedHome` |
| `Unlocked`           | unlock id              | union (`Nightmare`, recording, the veteran grant, the first-escape purse, the doubled day)  | `UnlockedNightmare`, `UnlockedRecording`, `GrantedVeteranRank`, `DoubledFirstRun` |

### What this means

- **No server rejection.** Every `MutationRejected` today goes: a handler failure fails the whole batch. Spending is the one rule that wanted it; keying `BoughtCosmetic` by cosmetic id keeps a cosmetic from being paid twice, and Bones can dip below zero only by buying two different things on two offline devices, which shows as a negative balance until the next run.
- **Deterministic handlers.** A handler runs on every device and the server, in id order on replay: no clock, no randomness, only the payload, the conflicts, and the projection. The game's own determinism rule covers it.
- **Schemas only grow.** The journal replays every entry ever written, so a new field accepts absence, and a field is never renamed or narrowed (the rules at the top of `EventRow.ts`). This replaces `SAVE_VERSION` and the migrations, from launch on.
- **Linking is the identity.** Devices sync when they share an `EventLog.Identity`; the link code carries it, and `packages/sync-engine` and the device pairing go.
- **Compaction later.** `EndedRun` and `GainedMastery` grow a row per run. `EventRow.compaction` and the compaction RPCs can fold them once the journal is large; not needed for launch.
- **Unencrypted.** The server reads the data (co-op lobbies, a future leaderboard), and the socket is TLS.
