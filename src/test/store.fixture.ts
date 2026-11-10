import {
  Context,
  Effect,
  Function,
  Layer,
  Option,
  Ref,
  Schedule,
  type Scope,
} from 'effect'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { SqliteClient, type SqliteOpenError } from '@munch/sqlite-wasm-effect'
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

import { defaultAppearance } from '../app/model'
import { LinkedDevices, PlayerScope } from '../platform/playerScope'
import { changesBetween } from '../platform/playerSync'
import {
  type PlayerSave,
  SAVE_VERSION,
  noSavedBests,
  unpickedDifficulty,
} from '../platform/save'
import {
  type LegacySave,
  type PlayerDatabase,
  type SyncSetup,
  makePlayerDatabase,
} from '../platform/storeSqlite'
import { noSavedRunRecords } from '../shared/playerData'
import { noRank } from '../world/heroes/rank'

// NOTE: what the store tests (src/platform/__tests__/store.test.ts) start from: a save, a fake
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
    intro: 'Unseen',
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

type OpenedDatabase = Effect.Effect<
  PlayerDatabase,
  Effect.Error<ReturnType<typeof makePlayerDatabase>> | SqliteOpenError,
  Scope.Scope
>

// NOTE: one hub is one device's database. Each open is a page load on it,
// syncing through `maybeSetup` when it holds one.
/** @stability unstable */
export const openSyncingOn: {
  (
    legacy: LegacySave,
    maybeSetup: Option.Option<SyncSetup>,
  ): (hub: Hub) => OpenedDatabase
  (
    hub: Hub,
    legacy: LegacySave,
    maybeSetup: Option.Option<SyncSetup>,
  ): OpenedDatabase
} = Function.dual(
  3,
  (
    hub: Hub,
    legacy: LegacySave,
    maybeSetup: Option.Option<SyncSetup>,
  ): OpenedDatabase =>
    Effect.gen(function* () {
      const context = yield* Layer.build(hub.layer())
      return yield* makePlayerDatabase(
        Context.get(context, SqliteClient),
        legacy,
        maybeSetup,
      )
    }),
)

// NOTE: a device with no sync set up.
/** @stability unstable */
export const openOn: {
  (legacy: LegacySave): (hub: Hub) => OpenedDatabase
  (hub: Hub, legacy: LegacySave): OpenedDatabase
} = Function.dual(2, (hub: Hub, legacy: LegacySave): OpenedDatabase =>
  openSyncingOn(hub, legacy, Option.none()),
)

/** @stability unstable */
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

export const write: {
  (
    before: PlayerSave,
    after: PlayerSave,
  ): (database: PlayerDatabase) => ReturnType<PlayerDatabase['write']>
  (
    database: PlayerDatabase,
    before: PlayerSave,
    after: PlayerSave,
  ): ReturnType<PlayerDatabase['write']>
} = Function.dual(
  3,
  (database: PlayerDatabase, before: PlayerSave, after: PlayerSave) =>
    database.write(after, changesBetween(before, after)),
)

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
/** @stability unstable */
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
          Effect.mapBoth(verifyToken(SECRET, token, now), {
            onFailure: error => Unauthorized.make({ reason: error.reason }),
            onSuccess: claims =>
              Actor.cases.Device.make({
                playerId: claims.playerId,
                deviceId: claims.deviceId,
              }),
          }),
      ),
  })
  const clock = yield* Effect.clockWith(Effect.succeed)
  const now = () => clock.currentTimeMillisUnsafe()
  const claimsOf = (token: string) =>
    Effect.mapError(verifyToken(SECRET, token, now()), error =>
      IdentityRefused.make({
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
export const until: {
  <A>(
    done: (value: A) => boolean,
  ): <E>(probe: Effect.Effect<A, E>) => Effect.Effect<A, E>
  <A, E>(
    probe: Effect.Effect<A, E>,
    done: (value: A) => boolean,
  ): Effect.Effect<A, E>
} = Function.dual(
  2,
  <A, E>(
    probe: Effect.Effect<A, E>,
    done: (value: A) => boolean,
  ): Effect.Effect<A, E> =>
    settle(
      Effect.repeat(probe, {
        until: done,
        schedule: Schedule.spaced('20 millis'),
      }),
    ),
)

// NOTE: a phone with the legacy save, and a laptop linked to its player.
/** @stability unstable */
export const linkedPair = Effect.gen(function* () {
  const server = yield* makeServer
  const network = yield* server.host.network()
  const setup = Option.some<SyncSetup>({
    identityApi: server.api,
    transports: [network.transport],
  })
  const value_1 = yield* makeHub()
  const phone = yield* openSyncingOn(
    value_1,
    (yield* makeLegacy(Option.some(legacySave))).legacy,
    setup,
  )
  const value_2 = yield* makeHub()
  const laptop = yield* openSyncingOn(
    value_2,
    (yield* makeLegacy(Option.none())).legacy,
    setup,
  )
  yield* phone.load
  const requestLinkCode_1 = yield* phone.requestLinkCode
  yield* laptop.redeemLinkCode(requestLinkCode_1)
  yield* until(laptop.load, maybeSave =>
    Option.exists(maybeSave, save => save.appearance.hairColor === 'Red'),
  )
  return { phone, laptop }
})
