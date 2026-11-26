import {
  Clock,
  Context,
  Effect,
  Function,
  Layer,
  Option,
  Ref,
  Schedule,
  type Scope,
  String,
} from 'effect'
import { EventLogServer, EventLogServerUnencrypted } from 'effect/eventlog'
import type { Rpc } from 'effect/rpc'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'

import { CODE_ALPHABET } from '@munch/netcode'
import { SqliteClient, type SqliteOpenError } from '@munch/sqlite-wasm-effect'
import { type Hub, makeHub } from '@munch/sqlite-wasm-effect/in-process'

import { defaultAppearance } from '#app/model.ts'
import type { Transport } from '#platform/coop/roomReplica.ts'
import { PlayerLogSchema } from '#platform/save/playerEvents.ts'
import {
  PlayerHandlers,
  createPlayerTables,
} from '#platform/save/playerProjection.ts'
import { changesBetween } from '#platform/save/playerSync.ts'
import {
  type PlayerSave,
  SAVE_VERSION,
  noSavedBests,
  unpickedDifficulty,
} from '#platform/save/save.ts'
import {
  type LegacySave,
  type PlayerDatabase,
  type SyncSetup,
  makePlayerDatabase,
} from '#platform/save/storeSqlite.ts'
import { noDareMarks } from '#shared/records/dareMarkData.ts'
import { noJournal } from '#shared/records/journalData.ts'
import { noMastery } from '#shared/records/masteryData.ts'
import { noMissions } from '#shared/records/missionData.ts'
import { noBonuses, noSavedRunRecords } from '#shared/records/playerData.ts'
import { noProof } from '#shared/records/proofData.ts'
import {
  PlayerLogRpcs,
  RedeemAnswer,
  SessionRefused,
  SessionRpcs,
  playerStoreOf,
} from '#shared/records/sessionApi.ts'
import { noRank } from '#world/heroes/rank.ts'

export const legacySave: PlayerSave = {
  version: SAVE_VERSION,
  onboarding: {
    lessons: {
      move: 'Learned',
      fire: 'Learned',
      startWave: 'Pending',
      swap: 'Pending',
      pickup: 'Pending',
      timedBreaks: 'Pending',
      openBreak: 'Pending',
      dareTour: 'Pending',
      dareKey: 'Pending',
      rattles: 'Pending',
      displayCase: 'Pending',
      dareCard: 'Pending',
      gunLevel: 'Pending',
    },
    trapHint: 'Seen',
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
  rumble: 'Off',
  name: 'Lil Gnaw',
  records: noSavedRunRecords,
  rank: noRank,
  bonuses: noBonuses,
  lastRun: 'NoRunYet',
  missions: noMissions,
  proof: noProof,
  journal: noJournal,
  mastery: noMastery,
  dareMarks: noDareMarks,
  calling: 'You',
  boughtCosmetics: [],
  seenUnlocks: [],
  recordRuns: 'Off',
  recordUnlock: 'Locked',
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

export const openOn: {
  (legacy: LegacySave): (hub: Hub) => OpenedDatabase
  (hub: Hub, legacy: LegacySave): OpenedDatabase
} = Function.dual(2, (hub: Hub, legacy: LegacySave): OpenedDatabase =>
  openSyncingOn(hub, legacy, Option.none()),
)

export const sqlOn = (hub: Hub) =>
  Effect.map(Layer.build(hub.layer()), context =>
    Context.get(context, SqlClient.SqlClient),
  )

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

const SESSION_MS = 3_600_000

const PLAYER_STORE_PREFIX = 'player:'

const forbidden = (publicKey: string, storeId: string) =>
  new EventLogServerUnencrypted.EventLogServerAuthError({
    reason: 'Forbidden',
    publicKey,
    message: `${publicKey} may not use ${storeId}`,
  })

const ownerOnly = (publicKey: string, storeId: string) =>
  storeId === playerStoreOf(publicKey)
    ? Effect.void
    : Effect.fail(forbidden(publicKey, storeId))

const OwnerOnly = Layer.succeed(
  EventLogServerUnencrypted.EventLogServerAuthorization,
  {
    authorizeWrite: ({ publicKey, storeId }) => ownerOnly(publicKey, storeId),
    authorizeRead: ({ publicKey, storeId }) => ownerOnly(publicKey, storeId),
    authorizeIdentity: () => Effect.void,
  },
)

const PlayerStores = Layer.succeed(EventLogServerUnencrypted.StoreMapping, {
  resolve: ({ storeId, publicKey }) =>
    String.startsWith(PLAYER_STORE_PREFIX)(storeId)
      ? Effect.succeed(storeId)
      : Effect.fail(
          new EventLogServerUnencrypted.EventLogServerStoreError({
            reason: 'NotFound',
            publicKey,
            storeId,
          }),
        ),
  hasStore: ({ storeId }) =>
    Effect.succeed(String.startsWith(PLAYER_STORE_PREFIX)(storeId)),
})

const notSignedIn = () => SessionRefused.make({ problem: 'NotSignedIn' })

const signedInKey = (client: Rpc.ServerClient) =>
  Effect.mapError(
    Effect.fromOption(
      Option.flatMap(
        Context.getOption(
          client.annotations,
          EventLogServer.AuthenticatedIdentities,
        ),
        keys => Option.fromIterable(keys),
      ),
    ),
    notSignedIn,
  )

const testLinkCodeOf = (count: number) =>
  `LNKCD${Option.getOrElse(String.charAt(CODE_ALPHABET, count), () => 'Z')}`

const sessionHandlers = (codes: Ref.Ref<ReadonlyMap<string, string>>) =>
  SessionRpcs.toLayer({
    'Session.Mint': (_, { client }) =>
      Effect.gen(function* () {
        const publicKey = yield* signedInKey(client)
        const nowMs = yield* Clock.currentTimeMillis
        return { token: `token-${publicKey}`, expiresMs: nowMs + SESSION_MS }
      }),
    'Session.CreateLinkCode': ({ identity }, { client }) =>
      Effect.gen(function* () {
        yield* signedInKey(client)
        const nowMs = yield* Clock.currentTimeMillis
        const code = yield* Ref.modify(codes, known => {
          const next = testLinkCodeOf(known.size)
          return [next, new Map([...known, [next, identity]])]
        })
        return { code, expiresMs: nowMs + SESSION_MS }
      }),
  })

const NO_TRANSPORT: Transport = { name: 'none', open: () => Effect.never }

export const makeServer = Effect.gen(function* () {
  const hub = yield* makeHub()
  const codes = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
  const projection = Layer.effectDiscard(createPlayerTables).pipe(
    Layer.provideMerge(PlayerHandlers),
    Layer.provide(hub.layer()),
  )
  const handlers = yield* Layer.build(
    Layer.mergeAll(
      EventLogServerUnencrypted.layerNoRpcServer(PlayerLogSchema, projection),
      sessionHandlers(codes),
    ).pipe(
      Layer.provide([
        OwnerOnly,
        PlayerStores,
        EventLogServerUnencrypted.layerStorageMemory,
      ]),
    ),
  )
  const setup: SyncSetup = {
    connect: () =>
      Effect.provideContext(RpcTest.makeClient(PlayerLogRpcs), handlers),
    redeem: code =>
      Effect.map(Ref.get(codes), known =>
        Option.match(Option.fromNullishOr(known.get(code)), {
          onNone: () =>
            RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
          onSome: identity => RedeemAnswer.cases.Redeemed.make({ identity }),
        }),
      ),
    transports: [NO_TRANSPORT],
  }
  return { setup }
})

const SETTLE_STEP = '10 millis'
const SETTLE_TURNS = 20
const SETTLE_LIMIT = '30 seconds'

const driveClock: Effect.Effect<never> = Effect.forever(
  Effect.andThen(
    Effect.repeat(Effect.yieldNow, { times: SETTLE_TURNS - 1 }),
    TestClock.adjust(SETTLE_STEP),
  ),
)

const settle = <A, E, R>(
  wait: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.raceFirst(
    Effect.timeoutOrElse(wait, {
      duration: SETTLE_LIMIT,
      orElse: () => Effect.die('Still waiting after 30 s of test clock'),
    }),
    driveClock,
  )

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

export const linkedPair = Effect.gen(function* () {
  const server = yield* makeServer
  const setup = Option.some(server.setup)
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
