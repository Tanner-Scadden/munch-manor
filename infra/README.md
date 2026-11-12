# Infra

The Cloudflare side of Munch Manor, declared with [Alchemy](https://alchemy.run/). It has its own `package.json`, with Alchemy 2.0.0-beta.85 on `effect` 4.1.0, the same Effect the game, the packages, and the Foldkit Block preview use. Versions are pinned exactly, since Alchemy v2 is still in beta; move `effect` here and in the root `package.json` together.

| File                                               | What it holds                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `alchemy.run.ts`                                   | The game as a `Cloudflare.Website.Foldkit` Worker, the analytics API Worker and its D1, and the comment |
| `github.ts`                                        | The narrow CI token and the two GitHub Actions secrets it is written to                                 |
| `worker/api.ts`                                    | The analytics `HttpApi`: `POST /api/runs` and `GET /api/health`, its errors, and the handlers           |
| `worker/rules.ts`                                  | The pure rules: the size cap, the rate limit decision, the daily address hash input, and the D1 row     |
| `worker/main.ts`                                   | The Worker entry: `/sync` paths to sync, the rest to analytics, and the daily retention cleanup         |
| `worker/sync.ts`                                   | The sync Durable Objects (`SyncScope`, `SyncDirectory`) and the `/sync` routes                          |
| `worker/syncCore.ts`                               | The sync logic they run, kept apart so the tests cover it without the Workers runtime                   |
| `worker/gameRoom.ts`                               | The co-op `GameRoom` Durable Object (a room's lobby scope and its run) and the `/room` routes           |
| `worker/gameRoomCore.ts`                           | The room's logic apart from the runtime: the scope host, reactions, the Hello answer, the alarm         |
| `worker/matchmaker.ts`, `worker/matchmakerCore.ts` | QUICK PLAY's `Matchmaker` Durable Object and its logic                                                  |
| `worker/roomCalls.ts`                              | The internal calls between the Worker, the rooms, and the Matchmaker                                    |
| `worker/workerd.d.ts`                              | Types for the Workers globals the sync object uses (`WebSocketPair`, auto-responses)                    |
| `worker/*.test.ts`                                 | `it.effect` tests for the rules and the handler, over in-memory SQLite with the real migration          |
| `migrations/`                                      | The analytics D1 migrations, applied in order on deploy                                                 |
| `vitest.config.ts`                                 | The tests, run by vitest under Bun, with the shared game files and the sync engine on infra's Effect    |

## Stages

| Stage         | Game Worker               | API Worker                    | D1 database                         |
| ------------- | ------------------------- | ----------------------------- | ----------------------------------- |
| `prod`        | `munch-manor`             | `munch-manor-api`             | `munch-manor-analytics`             |
| `pr-<number>` | `munch-manor-pr-<number>` | `munch-manor-api-pr-<number>` | `munch-manor-analytics-pr-<number>` |

Every stage, production included, binds the API Worker's `GAME_ROOMS` and `MATCHMAKER` Durable Objects (approved 2026-10-29). Every stage but `prod` also gets the co-op dev page, `munch-manor-mp-dev-<stage>` (a static site built by `tools/mp-dev/build.ts`, pointed at the stage's API Worker).
| any other | `munch-manor-<stage>` | `munch-manor-api-<stage>` | `munch-manor-analytics-<stage>` |

Every Worker lives at `https://<worker>.tanner-scadden.workers.dev`. Production also has its own domain: the game at `https://munchmanor.com` (a Workers Custom Domain, with `www.munchmanor.com` redirecting to it by a 301 rule) and the API Worker at `https://api.munchmanor.com`, so production's `VITE_API_ORIGIN` is `https://api.munchmanor.com`. Its `workers.dev` addresses stay on and are never redirected, since saves and installed apps are bound to their origin (see "Two origins" in `PLATFORM.md`). The CI token has Zone Read, Workers Routes Write, and Dynamic URL Redirects Write on the `munchmanor.com` zone alone for this (`github.ts`). A stage such as `dev-infra` is a scratch copy deployed from this machine; destroy it when done. Destroying a stage deletes its D1 database and its rows.

State lives in Alchemy's Cloudflare state store (the `alchemy-state-store` Worker on the same account), so local and CI deploys share it.

## Deploying

`.github/workflows/deploy.yml` is the only deploy path. Cloudflare Workers Builds stays disconnected, so do not connect the repo in the Cloudflare dashboard: two deploy paths overwrite each other quietly (see "What Phase 1 taught us" in `PLATFORM.md`). GitHub Pages is gone, its workflow deleted and the site disabled.

- **Push to `main`.** The check job runs `typecheck`, `lint`, `test`, and `build`, and typechecks `infra/`. Only if all pass does the deploy job run `alchemy deploy --stage prod`, then wait for the URL (`https://munchmanor.com`) to answer 200. A failing check publishes nothing.
- **Pull request.** The same checks, then a preview at `https://munch-manor-pr-<number>.tanner-scadden.workers.dev`, with its URL in a comment on the pull request. Closing the pull request destroys the preview.
- **By hand.** Run the workflow from the Actions tab on `main` to redeploy production, or deploy from this machine with the commands below.

Alchemy skips the build and the upload when none of `src/`, `packages/*/src/`, `packages/*/package.json`, `public/`, `patches/`, `index.html`, `CHANGELOG.md`, `vite.config.ts`, `tsconfig.json`, `package.json`, or `bun.lock` changed (`memo` in `alchemy.run.ts`).

**The static build.** `bun run build` writes a static site to `dist/`. Vite's `base` is `'./'`, so every asset path is relative and `dist/` works from any sub-path. Check it with `bunx vite preview` before publishing. It needs an HTTP server: opening `dist/index.html` straight from disk does not load the module script.

**itch.io.** `bun run build:itch` (`tools/itch/build.sh`) builds against production's API, so co-op, device linking, and run summaries work from itch's frame, writes the self-removing service worker, points a shared room link at munchmanor.com (`VITE_ROOM_LINK_BASE`), and zips `dist/` with `index.html` at the top into `tools/itch/out/`. The page is https://tannerscadden.itch.io/munch-manor (its words and settings are in `tools/itch/page.md`). After each production deploy, the workflow's `itch` job builds the same commit and pushes it with butler to `tannerscadden/munch-manor:html5`, unless nothing the site is built from changed since the build itch has. By hand: `BUTLER_API_KEY=$(security find-generic-password -s itch-api-key -w) butler push tools/itch/out/<zip> tannerscadden/munch-manor:html5`. A plain build without `VITE_API_ORIGIN` sends no analytics and keeps the save on the device.

## Commands

Run from `infra/` after `bun install`. A local deploy builds the working tree as it is, uncommitted changes included.

```sh
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
export CLOUDFLARE_ACCOUNT_ID=<the 32 character account id>

bun alchemy plan --stage prod               # what would change
bun alchemy deploy --stage prod             # deploy production by hand
bun alchemy deploy --stage prod --force     # redeploy even when nothing changed
bun alchemy destroy --stage pr-12           # tear down a preview
bun run typecheck                           # types and the Effect diagnostics
bun run lint                                # oxlint, then the Effect rules
bun run test                                # the Worker's tests (vitest under Bun)
```

Alchemy skips the build when no input changed, and `alchemy drift` does not notice a Worker that something else overwrote. Use `--force` to put the declared version back.

## Sync

The same API Worker serves `/sync` for the sync engine (see "What phase 4 built" in `PLATFORM.md` and `packages/sync-engine/README.md`). Keeping it in one Worker gives the game one API origin and one deploy.

| Path                         | Goes to                                        | What it does                                                        |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| `POST /sync/challenge`       | the Worker                                     | A stateless, MACed nonce for the device to sign                     |
| `POST /sync/session`         | `SyncDirectory`                                | Trades a signed nonce for a session token, registering a new device |
| `POST /sync/link`            | `SyncDirectory`                                | A link code for the token's player                                  |
| `POST /sync/link/redeem`     | `SyncDirectory`, then the player's `SyncScope` | Moves the device to the code's player and records the device count  |
| `GET /sync/socket?scope=`    | the scope's `SyncScope`                        | The WebSocket, accepted with the Hibernation API                    |
| `POST /sync/exchange?scope=` | the scope's `SyncScope`                        | The HTTP fallback: a batch of protocol messages in, the replies out |

- **Durable Objects.** `SyncScope` (one per `player:<id>`, by name) and `SyncDirectory` (one, named `directory`) are SQLite backed, so they run on the free plan, and declared as `Cloudflare.DurableObject` bindings on the API Worker; Alchemy adds them as new SQLite classes. Their SQL goes through `@effect/sql-sqlite-do` 4.1.0. They are plain classes with `fetch` and `webSocketMessage`, so the bundle never imports `cloudflare:workers`.
- **Secrets and limits.** `SyncSecret` (an `Alchemy.Random` per stage) signs tokens and nonces. `SYNC_BY_ADDRESS` (namespace 7103) allows 30 identity requests a minute per address. Sockets and exchanges need a valid token in their Hello.
- **The shared files.** The Worker bundles `src/platform/playerScope.ts`, `src/shared/playerData.ts`, and the engine against infra's Effect, the same way as `src/platform/analytics.ts`.

## Co-op rooms

On every stage the API Worker also serves co-op rooms (see "What Phases 2 and 3 built" in `MULTIPLAYER.md`).

| Path                        | Goes to               | What it does                                                                   |
| --------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| `POST /room/create`         | a new `GameRoom`      | A private room under a fresh five-symbol code, with the caller as host         |
| `POST /room/join`           | the code's `GameRoom` | Seats the caller while the room is in its lobby                                |
| `GET /room/socket?code=`    | the code's `GameRoom` | The binary game socket, Hello with the session token first                     |
| `GET /room/quick`           | the `Matchmaker`      | The QUICK PLAY socket: the queue, the offer to start with fewer, then the room |
| `/sync/*?scope=room:<code>` | the code's `GameRoom` | The room's lobby scope over the sync engine                                    |

- **Durable Objects.** `GameRoom` (one per room, named `room:<code>`) and `Matchmaker` (one, named `matchmaker`), both SQLite backed, added by Alchemy as new SQLite classes on the stages that bind them. A room runs a timer loop only during a run, so it hibernates in its lobby; the Matchmaker hibernates while nobody waits.
- **Locally.** `bun tools/mp-dev/local.ts` runs this Worker (sync and rooms, no analytics) in `node_modules/.bin/workerd`, and `bun run mp:e2e` (from the repo root) plays three players and a QUICK PLAY group through it.
- **Logs.** The API Worker keeps Workers Logs (`API_OBSERVABILITY` in `alchemy.run.ts`). Each co-op run's end is one `RoomGameEnded` line with every seat's round trip, late inputs, reconnects, and the room's tick lag: see "Reading the room's logs" in `PLATFORM.md`. Live: `bunx wrangler tail munch-manor-api --format json --search RoomGameEnded`.
- **On a preview.** `bun run heavy -- --shared bun tools/audit/mp.ts https://munch-manor-mp-dev-pr-<n>.tanner-scadden.workers.dev/ 4` from the repo root.

## Analytics

The game posts one run summary per run to its stage's API Worker (see "Analytics" in `PLATFORM.md`). The Website gets the API Worker's URL as `VITE_API_ORIGIN`, which Vite inlines into the game.

- **Two Effects.** The Worker imports `src/platform/analytics.ts`, which the game shares. Its `effect` import would otherwise resolve from the game's `node_modules`, a second copy of Effect 4.1.0 beside infra's, so three things point it at infra's own copy: the Worker bundle's `resolve.alias` in `alchemy.run.ts`, `paths` in `tsconfig.json`, and the `one-effect` plugin in `vitest.config.ts` for the tests, which also inlines `foldkit` so it uses that copy. Keep `src/platform/analytics.ts` importing only `effect`.
- **Migrations.** Add a new numbered file to `migrations/`, such as `0002_add_column.sql`. Never edit one that has shipped: Alchemy records each file's hash in the database's `__alchemy_migrations` table and applies new files in order on the next deploy.
- **Secrets.** The address salt is an `Alchemy.Random`, made once per stage and kept in Alchemy's state. It reaches the Worker as a `secret_text` binding.
- **Rate limits.** Cloudflare Rate Limiting bindings, namespaces 7101 (per visit) and 7102 (per address bucket), shared by every stage.
- **Retention.** Run rows are kept for 90 days. Production's API Worker has the Cron Trigger `17 4 * * *` (`RETENTION_CRON` in `alchemy.run.ts`), and the `scheduled` handler in `worker/main.ts` runs `deleteExpiredRuns` (`worker/api.ts`) over D1, deleting rows whose `received_day` is before `retentionCutoffDay` (`worker/rules.ts`). Other stages get `crons: []`: the free plan allows five Cron Triggers per account, and a preview's database is destroyed with it. The rule is covered by the Worker's tests. The schedule shows under the Worker's **Settings**, **Trigger events** in the dashboard.

```sh
bun run test                                                 # the Worker's tests
bun tools/analytics/smoke.ts https://munch-manor-api-pr-12.tanner-scadden.workers.dev   # post one fake run (from the repo root)
bun tools/analytics/smoke.ts https://api.munchmanor.com                                # the same against production
bun tools/analytics/report.ts --stage pr-12                  # the report for a stage (from the repo root)
bun run heavy -- bun tools/audit/beacon-check.ts https://munch-manor-pr-12.tanner-scadden.workers.dev/   # a real run end in headless Chrome
```

The report and the smoke test use `CLOUDFLARE_API_TOKEN` (or the keychain token) and `CLOUDFLARE_ACCOUNT_ID` (or the token's only account). The smoke test marks its rows with the build `smoke-test`.

## Credentials

Never put a token in the repo or in a `VITE_` variable, which Vite inlines into the game.

- **Local:** the API token in the macOS keychain under `cloudflare-api-token`. It is broad: it can also create API tokens, which `github.ts` needs. The itch.io API key (account `tannerscadden`) is in the keychain under `itch-api-key`.
- **CI:** the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets, and `BUTLER_API_KEY` (the itch.io key, for uploads with butler), all written by `github.ts`. That token is the account-owned `munch-manor-ci` token with Workers Scripts Write, Secrets Store Write, Account Settings Read, Workers Tail Read, D1 Write (for the analytics databases), and Workers R2 Storage Write (for the recordings bucket, `RECORDINGS`). Secrets Store Write is needed because Alchemy reads the state store's token by binding it to a short-lived preview Worker.

To rotate the CI token, the itch.io key, or change permissions, edit `github.ts` (or update the keychain item) and run:

```sh
export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
export CLOUDFLARE_ACCOUNT_ID=<the 32 character account id>
export GITHUB_TOKEN=$(gh auth token)
export ITCH_API_KEY=$(security find-generic-password -s itch-api-key -w)
bun alchemy plan github.ts --stage prod     # check what changes first
bun alchemy deploy github.ts --stage prod --yes
```

To replace the itch.io key, generate a new one on itch.io (Settings, API keys), store it with `security add-generic-password -U -s itch-api-key -a munch-manor -w`, which prompts for it so it stays out of the shell history, and deploy as above.

If the repository is renamed, change `REPOSITORY` and deploy twice, the second time with `--force`. The rename makes Alchemy replace each secret: it writes the new one, then deletes the old one, and GitHub redirects the old name to the same repository, so the delete removes the secret just written. The forced deploy writes it again. Check with `gh secret list`.

## Updates on installed apps

The Vite build stamps the bundle and `version.json` with `GITHUB_SHA`, which the Alchemy build child inherits in CI. A local deploy stamps the local commit, plus a timestamp when the tree is dirty. Alchemy skips the build when no input changed, so `version.json` only changes when the game does. See "How updates reach installed apps" in `PLATFORM.md`.

## Check a deploy

```sh
cd ../tools/audit && bun live-check.ts [url]   # https://munchmanor.com/ by default
```

It loads the page in headless Chrome and fails unless it answers 200, mounts four canvases, and logs no errors.
