import { Context, Effect, Layer, Option, Ref, Schedule } from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { SqliteClient } from '@munch/sqlite-wasm-effect'
import { type Hub, makeHub } from '@munch/sqlite-wasm-effect/in-process'
import {
  Actor,
  type IdentityApi,
  IdentityFailure,
  IdentityRefused,
  Unauthorized,
  makeChallenge,
  makeDirectory,
  verifyToken,
} from '@munch/sync-engine'
import { type Host, makeHost } from '@munch/sync-engine/in-process'
import { settle } from '@munch/sync-engine/testing'

import { defaultAppearance } from './model'
import { noSavedRunRecords } from './playerData'
import { LinkedDevices, PlayerScope } from './playerScope'
import { changesBetween } from './playerSync'
import { noRank } from './rank'
import {
  type PlayerSave,
  SAVE_VERSION,
  noSavedBests,
  unpickedDifficulty,
} from './save'
import {
  type LegacySave,
  type PlayerDatabase,
  type SyncSetup,
  makePlayerDatabase,
} from './storeSqlite'

// NOTE: what the store tests (src/store.test.ts) start from: a save, a fake
// localStorage, one device's database on a hub, and a server in this
// process for linking devices.

export const legacySave: PlayerSave = {
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Pending',
      shop: 'Pending',
      swap: 'Pending',
      pickup: 'Pending',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
    },
    trapHint: 'Seen',
    ammoTip: 'Unseen',
    introducedKinds: ['Shambler'],
  },
  homeScreenTip: 'Dismissed',
  settings: {
    sound: 'Muted',
    music: 'On',
    shake: 'Off',
    shareStats: 'On',
    cursor: 'Thin',
  },
  appearance: { ...defaultAppearance, hairColor: 'Red' },
  difficulty: { ...unpickedDifficulty, chosen: 'Hard', card: 'Seen' },
  bests: {
    ...noSavedBests,
    runsPlayed: 3,
    totalKills: 57,
    killsByKind: { Shambler: 50, Runner: 7 },
    byDifficulty: {
      ...noSavedBests.byDifficulty,
      Normal: { fastestWinMs: 402_000, bestEndlessWave: 12 },
    },
  },
  home: { seenNewsDay: 'October 28, 2026', openedEntries: ['Shambler'] },
  seenPowerUps: ['RapidFire'],
  rotation: 'Landscape',
  name: 'Lil Gnaw',
  records: noSavedRunRecords,
  rank: noRank,
  calling: 'You',
  boughtCosmetics: [],
  seenUnlocks: [],
}

export interface FakeLegacy {
  readonly legacy: LegacySave
  readonly reads: Effect.Effect<number>
  readonly stored: Effect.Effect<Option.Option<PlayerSave>>
}

export const makeLegacy = (
  initial: Option.Option<PlayerSave>,
): Effect.Effect<FakeLegacy> =>
  Effect.gen(function* () {
    const stored = yield* Ref.make(initial)
    const reads = yield* Ref.make(0)
    return {
      legacy: {
        read: Effect.andThen(
          Ref.update(reads, n => n + 1),
          Ref.get(stored),
        ),
        write: save => Ref.set(stored, Option.some(save)),
      },
      reads: Ref.get(reads),
      stored: Ref.get(stored),
    }
  })

// NOTE: one hub is one device's database. Each open is a page load on it.
export const openOn = (
  hub: Hub,
  legacy: LegacySave,
  maybeSetup: Option.Option<SyncSetup> = Option.none(),
) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(hub.layer())
    return yield* makePlayerDatabase(
      Context.get(context, SqliteClient),
      legacy,
      maybeSetup,
    )
  })

export const sqlOn = (hub: Hub) =>
  Effect.map(Layer.build(hub.layer()), context =>
    Context.get(context, SqlClient.SqlClient),
  )

// NOTE: syncing tests run on `it.effect`'s TestClock, so the sync's backoff,
// heartbeat, and resend timer, the server's token times, and the waits in
// `until` all move only as `settle` moves them. A loaded machine changes how
// long a test takes, never what it sees. `synced` starts the clock at a real
// date, since the server's tokens are stamped with it.
const SYNC_EPOCH_MS = Date.UTC(2026, 9, 30)

export const synced = <A, E, R>(
  program: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.andThen(TestClock.setTime(SYNC_EPOCH_MS), program)

export const write = (
  database: PlayerDatabase,
  before: PlayerSave,
  after: PlayerSave,
) => database.write(after, changesBetween(before, after))

export const muted = (save: PlayerSave): PlayerSave => ({
  ...save,
  settings: { ...save.settings, sound: 'On' },
})

// SYNC

const SECRET = 'store-test-secret'

const openServerDatabase = () =>
  Effect.gen(function* () {
    const hub = yield* makeHub()
    return yield* Effect.orDie(sqlOn(hub))
  })

// NOTE: the server side in this process: a Directory for identity and
// linking, and the scope host for the player scopes, wired the way
// infra/worker/sync.ts wires them on Cloudflare.
export const makeServer = Effect.gen(function* () {
  const directorySql = yield* openServerDatabase()
  const directory = yield* Effect.provideService(
    makeDirectory(SECRET),
    SqlClient.SqlClient,
    directorySql,
  )
  const host: Host = yield* makeHost({
    definitions: [PlayerScope],
    openDatabase: openServerDatabase,
    authenticate: token =>
      Effect.flatMap(
        Effect.orDie(Effect.clockWith(clock => clock.currentTimeMillis)),
        now =>
          Effect.map(
            Effect.mapError(
              verifyToken(SECRET, token, now),
              error => new Unauthorized({ reason: error.reason }),
            ),
            claims =>
              Actor.cases.Device.make({
                playerId: claims.playerId,
                deviceId: claims.deviceId,
              }),
          ),
      ),
  })
  const clock = yield* Effect.clockWith(Effect.succeed)
  const now = () => clock.currentTimeMillisUnsafe()
  const claimsOf = (token: string) =>
    Effect.mapError(
      verifyToken(SECRET, token, now()),
      error =>
        new IdentityRefused({
          failure: IdentityFailure.cases.Unauthorized.make({
            reason: error.reason,
          }),
        }),
    )
  const api: IdentityApi = {
    challenge: Effect.suspend(() =>
      Effect.map(Effect.orDie(makeChallenge(SECRET, now())), nonce => ({
        nonce,
      })),
    ),
    session: request => directory.session(request, now()),
    link: token =>
      Effect.flatMap(claimsOf(token), claims =>
        directory.createLinkCode(claims, now()),
      ),
    redeem: (token, code) =>
      Effect.gen(function* () {
        const claims = yield* claimsOf(token)
        const redeemed = yield* directory.redeem(claims, code, now())
        const server = yield* Effect.orDie(
          host.server(`player:${redeemed.session.playerId}`),
        )
        yield* Effect.orDie(
          server.runServer(
            LinkedDevices,
            { count: redeemed.session.devices },
            `linked-${redeemed.session.deviceId}-${redeemed.session.devices}`,
          ),
        )
        return redeemed.session
      }),
  }
  return { host, api }
})

// NOTE: polls on the TestClock, which settle moves.
export const until = <A, E>(
  probe: Effect.Effect<A, E>,
  done: (value: A) => boolean,
) =>
  settle(
    Effect.repeat(probe, {
      until: done,
      schedule: Schedule.spaced('20 millis'),
    }),
  )

// NOTE: a phone with the legacy save, and a laptop linked to its player.
export const linkedPair = Effect.gen(function* () {
  const server = yield* makeServer
  const network = yield* server.host.network()
  const setup = Option.some<SyncSetup>({
    identityApi: server.api,
    transports: [network.transport],
  })
  const phone = yield* openOn(
    yield* makeHub(),
    (yield* makeLegacy(Option.some(legacySave))).legacy,
    setup,
  )
  const laptop = yield* openOn(
    yield* makeHub(),
    (yield* makeLegacy(Option.none())).legacy,
    setup,
  )
  yield* phone.load
  yield* laptop.redeemLinkCode(yield* phone.requestLinkCode)
  yield* until(laptop.load, maybeSave =>
    Option.exists(maybeSave, save => save.appearance.hairColor === 'Red'),
  )
  return { phone, laptop }
})
