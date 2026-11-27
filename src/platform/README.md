# `src/platform/`

The browser and the Worker: the store, the save, sync, analytics, versions, the service worker.

Every module in this folder has its row below, its path from this folder (`bun run lint` fails a module no row names, and a row naming a file that is gone). Tests are not listed: each sits in the `__tests__/` folder beside the code it tests.

## At the top

| File                            | What it holds                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message.ts`, `deviceSchema.ts` | The root's Messages from the browser and the Worker, by group: the page, versions, the device, installing, loading, the save and sync, analytics; the device's Schemas (visibility, full screen, the screen's fit, the rotation lock, the install offer) |
| `early.ts`                      | Boot before the game's modules: the leader lock, the SQLite worker, and the store chunk                                                                                                                                                                  |
| `apiOrigin.ts`                  | The Worker's origin from `VITE_API_ORIGIN`                                                                                                                                                                                                               |
| `today.ts`                      | Today's day in UTC as a stream, read at start and checked each minute, for the Today Subscription                                                                                                                                                        |
| `version.ts`, `splash.ts`       | The build id, the `version.json` check, reloading, and the update marker; the loading splash's load steps                                                                                                                                                |
| `install.ts`                    | The `InstallPrompt` service that holds Chrome's install prompt                                                                                                                                                                                           |
| `clipboard.ts`                  | Copying to and reading the clipboard, with the old copy for browsers with no async clipboard, for a Mount to call in a tap's own click                                                                                                                   |
| `keyboard.ts`                   | A phone's keyboard over the page: `isTextField`, and the focused field lifted above the keyboard (`--keyboard-lift`) instead of the page resizing                                                                                                        |
| `serviceWorker.ts`              | Registering the service worker and handing over to a new build                                                                                                                                                                                           |
| `support.ts`                    | The tip jar's `SUPPORT_URL` (empty hides it) and its check                                                                                                                                                                                               |

## `analytics/`

| File                                                                                  | What it holds                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `analytics/analytics.ts`, `analytics/analyticsRun.ts`, `analytics/analyticsBeacon.ts` | The RunSummary Schema (shared with the Worker); when a run ends and its summary; the beacon that posts it                                  |
| `analytics/summaryQueue.ts`                                                           | Run summaries that end with no network: queued in the store (this device only), sent at the next start or online run end, 11 seconds apart |

## `coop/`

| File                                        | What it holds                                                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `coop/roomReplica.ts`, `coop/lobbyWrite.ts` | The co-op lobby's Replica in the player database (store chunk); a lobby change as the room scope's mutation, written through the leader tab's Replica or a follower tab's socket |

## `recording/`

| File                                                       | What it holds                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `recording/recording.ts`                                   | RECORD MY RUNS: the unlock, the recorder a run carries (its settings, start World, each tick's intents, the presses and other edits made outside the step), the finished `RunRecording` and its JSON, and the hash of its last World |
| `recording/recordingCodec.ts`, `recording/recordingApi.ts` | A recording's ticks as compact text, run-length coded in chunks; the recordings endpoint both sides read: its path, size cap, run id, content types, and the R2 key                                                                  |
| `recording/recordingUpload.ts`                             | Posting a finished recording, gzipped and signed with the sync token, or queuing it in the store when offline; the queue drained at start                                                                                            |

## `save/`

| File                                                           | What it holds                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save/save.ts`, `save/saveVersions.ts`                         | `PlayerSave`: the Model mapping, the reset, and the old localStorage copy; every older version's Schema and its migration, `decodeSave` and `encodeSave`                                                                                                                                                                         |
| `save/store.ts`, `save/storeSqlite.ts`, `save/store.worker.ts` | `PlayerStore`: SQLite or the localStorage fallback; the player's event log over SQLite (`effect/eventlog`'s journal), its identity, the seed and the old tables moved in once, a link's restart, the queues; the SQLite worker                                                                                                   |
| `save/playerEvents.ts`, `save/playerProjection.ts`             | The player log's events (`PlayerLogSchema`): the save's settings as one last-writer-wins row, the rest as events with their merge (counts add, bests and marks keep the larger, the first proof stamp stays), shared with the Worker; their handlers writing the save's tables, `readPlayerSave`, and the facts the Worker reads |
| `save/playerRemote.ts`, `save/playerSync.ts`                   | The player log's remote: the socket to the Worker, the sync state, the session token, and the link code asked and redeemed; save changes as `PlayerChange`s (`changesBetween`), the sync state, and `LinkProblem`                                                                                                                |
| `save/linkFlow.ts`                                             | Linking a device as an effect-machine machine: `LinkFlow` (idle, asking for a code, showing it, typing one, redeeming, linked, failed), its `LinkEvent`s, `linkMachine` (a late code or redeem after a cancel is dropped), `stepLink`, and the code's cleaning and problem text                                                  |
| `save/legacyTables.ts`                                         | The player scope's old tables read into one save, and dropped, once, as the log takes over                                                                                                                                                                                                                                       |
| `save/storeEarly.ts`                                           | The SQLite worker and the store chunk, started by `early.ts`                                                                                                                                                                                                                                                                     |

## `sw/`

| File                             | What it holds                                           |
| -------------------------------- | ------------------------------------------------------- |
| `sw/worker.ts`, `sw/precache.ts` | The worker; its precache list, built from Vite's output |
