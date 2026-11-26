import { Array, String } from 'effect'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Schedule from 'effect/Schedule'
import type * as Scope from 'effect/Scope'
import {
  EventJournal,
  EventLog,
  EventLogMessage,
  EventLogRemote,
  EventLogServerUnencrypted,
  SqlEventJournal,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'
import * as SqlClient from 'effect/sql/SqlClient'
import * as Statement from 'effect/sql/Statement'

import { describe, expect, it } from '@effect/vitest'

import { PlayerLogSchema } from '../../src/platform/playerEvents.ts'
import {
  PlayerHandlers,
  createPlayerTables,
  readPlayerFacts,
} from '../../src/platform/playerProjection.ts'
import {
  type LinkCode,
  PlayerLogRpcs,
  RedeemAnswer,
  SessionRefused,
  newIdentity,
  playerStoreOf,
} from '../../src/shared/sessionApi.ts'
import type { LinkCodeBook } from './linkCodes.ts'
import {
  DurableObjectStorage,
  type LinkCodeRequest,
  playerLogHandlers,
} from './playerLogCore.ts'
import { verifyToken } from './sessionToken.ts'
import { askPlayerFacts, encodeNightmareAnswer } from './syncCore.ts'
import { linkCodeBook, memory } from './testing.ts'

const SECRET = 'player-log-test-secret'

type Identity = EventLog.Identity['Service']

const serverFor = (owner: Identity, book: LinkCodeBook) =>
  Effect.gen(function* () {
    const sql = yield* memory
    const handlers = yield* Layer.build(
      playerLogHandlers({
        isHere: storeId => storeId === playerStoreOf(owner.publicKey),
        secret: SECRET,
        issueLinkCode: (request: LinkCodeRequest) => book.issue(request),
        sessionOf: () => Option.none(),
      }).pipe(Layer.provide(Layer.succeed(SqlClient.SqlClient, sql))),
    ).pipe(Effect.orDie)
    return { sql, handlers }
  })

type Server = Effect.Success<ReturnType<typeof serverFor>>

const clientOf = (server: Server) =>
  Effect.provideContext(RpcTest.makeClient(PlayerLogRpcs), server.handlers)

const deviceOf = (identity: Identity, server: Server) =>
  Effect.gen(function* () {
    const sql = yield* memory
    const client = yield* clientOf(server)
    return yield* Layer.build(
      Layer.effect(
        EventLogRemote.EventLogRemote,
        EventLogRemote.makeUnencrypted,
      ).pipe(
        Layer.provideMerge(
          EventLog.layer(PlayerLogSchema, PlayerHandlers).pipe(
            Layer.provideMerge(Layer.effectDiscard(createPlayerTables)),
            Layer.provide(SqlEventJournal.layer()),
            Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
          ),
        ),
        Layer.provideMerge(
          Layer.succeedContext(
            Context.make(EventLog.Identity, identity).pipe(
              Context.add(
                EventLog.CurrentStoreId,
                EventLogMessage.StoreId.make(playerStoreOf(identity.publicKey)),
              ),
              Context.add(EventLogRemote.EventLogRemoteClient, client),
            ),
          ),
        ),
      ),
    ).pipe(
      Effect.orDie,
      Effect.map(context => ({
        context,
        client,
        sql,
        signedIn: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
          Effect.provideService(
            Context.get(
              context,
              EventLogRemote.EventLogRemote,
            ).whenAuthenticated(effect),
            EventLog.Identity,
            identity,
          ),
      })),
    )
  })

const DURABLE_OBJECT_BOUND_PARAMETERS = 100

const DURABLE_OBJECT_COMPOUND_SELECT_TERMS = 5

const compoundTermsOf = (sql: string) => String.split(sql, 'UNION ALL').length

const asDurableObjectSqlite: Statement.Transformer = statement => {
  const [sql, parameters] = statement.compile()
  return parameters.length > DURABLE_OBJECT_BOUND_PARAMETERS
    ? Effect.die(
        `too many SQL variables: ${parameters.length} over ${DURABLE_OBJECT_BOUND_PARAMETERS}`,
      )
    : compoundTermsOf(sql) > DURABLE_OBJECT_COMPOUND_SELECT_TERMS
      ? Effect.die(
          `too many terms in compound SELECT: ${compoundTermsOf(sql)} over ${DURABLE_OBJECT_COMPOUND_SELECT_TERMS}`,
        )
      : Effect.succeed(statement)
}

const BIG_BATCH = 48
const EVENT_KINDS = 5

const bigBatch = Array.makeBy(BIG_BATCH, index =>
  EventJournal.Entry.make({
    id: EventJournal.makeEntryIdUnsafe({ msecs: index + 1 }),
    event: `Event${index % EVENT_KINDS}`,
    primaryKey: `key${index}`,
    payload: new Uint8Array(1),
  }),
)

const factsOn = (sql: SqlClient.SqlClient) =>
  Effect.provideService(readPlayerFacts, SqlClient.SqlClient, sql)

const eventually = <A, E>(
  check: Effect.Effect<A, E>,
  isDone: (value: A) => boolean,
): Effect.Effect<A, E> =>
  check.pipe(
    Effect.repeat({
      until: isDone,
      schedule: Schedule.spaced('10 millis'),
      times: 200,
    }),
  )

const signedInSetup: Effect.Effect<
  {
    readonly owner: Identity
    readonly server: Server
    readonly book: LinkCodeBook
  },
  never,
  Scope.Scope
> = Effect.gen(function* () {
  const owner = yield* newIdentity
  const book = yield* linkCodeBook
  const server = yield* serverFor(owner, book)
  return { owner, server, book }
})

describe("the player object's storage", () => {
  it.effect(
    'stores and looks up a batch too big for one Durable Object statement',
    () =>
      Effect.gen(function* () {
        const sql = yield* memory
        const context = yield* Layer.build(
          DurableObjectStorage.pipe(
            Layer.provide(Layer.succeed(SqlClient.SqlClient, sql)),
          ),
        )
        const storage = Context.get(context, EventLogServerUnencrypted.Storage)
        const storeId = EventLogMessage.StoreId.make('player')
        const written = yield* storage.withTransaction(
          storage.write(storeId, bigBatch),
        )
        const found = yield* storage.entriesAfter(
          storeId,
          Array.headNonEmpty(bigBatch),
          bigBatch,
        )
        expect(Array.map(found, entry => entry.remoteSequence)).toEqual(
          Array.map(written, entry => entry.remoteSequence),
        )
        expect(found).toHaveLength(BIG_BATCH)
      }).pipe(
        Effect.provideService(
          Statement.CurrentTransformer,
          asDurableObjectSqlite,
        ),
      ),
  )
})

describe('the player log', () => {
  it.live(
    'a socket that has not signed in gets no session token (live: the remote retries on a timer)',
    () =>
      Effect.gen(function* () {
        const { server } = yield* signedInSetup
        const client = yield* clientOf(server)
        const exit = yield* Effect.flip(client['Session.Mint']())
        expect(exit).toEqual(SessionRefused.make({ problem: 'NotSignedIn' }))
      }),
  )

  it.live(
    'a signed in owner mints a token for its own player (live: EventLog signs in on real crypto)',
    () =>
      Effect.gen(function* () {
        const { owner, server } = yield* signedInSetup
        const device = yield* deviceOf(owner, server)
        const session = yield* device.signedIn(device.client['Session.Mint']())
        const nowMs = yield* Clock.currentTimeMillis
        const claims = yield* verifyToken(SECRET, session.token, nowMs)
        expect(claims.playerId).toBe(owner.publicKey)
        expect(claims.expiresMs).toBe(session.expiresMs)
        const again = yield* device.client['Session.Mint']()
        const sameSocket = yield* verifyToken(SECRET, again.token, nowMs)
        expect(sameSocket.deviceId).toBe(claims.deviceId)
      }),
  )

  it.live(
    "another identity signed in on the socket cannot mint for this player's object (live: real crypto)",
    () =>
      Effect.gen(function* () {
        const { server } = yield* signedInSetup
        const stranger = yield* newIdentity
        const device = yield* deviceOf(stranger, server)
        const exit = yield* Effect.flip(
          device.signedIn(device.client['Session.Mint']()),
        )
        expect(exit).toEqual(SessionRefused.make({ problem: 'NotSignedIn' }))
      }),
  )

  it.live(
    'two devices of one player sync through the object, and its projection answers the facts (live: real crypto)',
    () =>
      Effect.gen(function* () {
        const { owner, server } = yield* signedInSetup
        const phone = yield* deviceOf(owner, server)
        const laptop = yield* deviceOf(owner, server)
        const write = yield* Effect.provideContext(
          EventLog.makeClient(PlayerLogSchema),
          phone.context,
        )
        yield* write({ event: 'UnlockedNightmare', payload: {} })
        yield* write({
          event: 'ClimbedDareLadder',
          payload: { difficulty: 'Hard', mark: 3 },
        })
        const onLaptop = yield* eventually(
          factsOn(laptop.sql),
          facts => facts.unlocked && facts.marks.Hard === 3,
        )
        expect(onLaptop.unlocked).toBe(true)
        const onServer = yield* eventually(
          factsOn(server.sql),
          facts => facts.unlocked && facts.marks.Hard === 3,
        )
        expect(onServer).toEqual(onLaptop)
        const answer = yield* encodeNightmareAnswer(onServer)
        const asked = yield* askPlayerFacts((store, url) => {
          expect(store).toBe(playerStoreOf(owner.publicKey))
          expect(url).toBe('https://player/internal/nightmare')
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve(answer),
          })
        }, owner.publicKey)
        expect(asked).toEqual(onServer)
      }),
  )

  it.live(
    'a link code holds the identity until it is redeemed once (live: real crypto)',
    () =>
      Effect.gen(function* () {
        const { owner, server, book } = yield* signedInSetup
        const device = yield* deviceOf(owner, server)
        const identity = EventLog.encodeIdentityString(owner)
        const code: LinkCode = yield* device.signedIn(
          device.client['Session.CreateLinkCode']({ identity }),
        )
        expect(code.code).toMatch(/^[A-Z2-9]{6}$/)
        const stranger = yield* newIdentity
        const notMine = yield* Effect.flip(
          device.client['Session.CreateLinkCode']({
            identity: EventLog.encodeIdentityString(stranger),
          }),
        )
        expect(notMine).toEqual(SessionRefused.make({ problem: 'NotSignedIn' }))
        const typed = `${String.slice(0, 3)(code.code)}-${String.toLowerCase(String.slice(3)(code.code))}`
        const redeemed = yield* book.redeem(typed)
        expect(redeemed).toEqual(RedeemAnswer.cases.Redeemed.make({ identity }))
        const twice = yield* book.redeem(code.code)
        expect(twice).toEqual(
          RedeemAnswer.cases.Refused.make({ problem: 'WrongCode' }),
        )
      }),
  )
})
