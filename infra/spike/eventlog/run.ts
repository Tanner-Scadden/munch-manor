import { Effect, Fiber, Layer, Scope } from 'effect'
import { EventLog, EventLogEncryption, EventLogMessage } from 'effect/eventlog'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { BunRuntime } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'

import {
  deviceLayer,
  entriesOf,
  gainMastery,
  goOnline,
  masteryOf,
  waitForEntries,
} from './device.ts'
import { readMastery } from './mastery.ts'
import { serverLayer } from './server.ts'
import { playerStoreOf } from './serverParts.ts'

const PORT = 8791
const URL = `ws://localhost:${PORT}/sync`
const dir = mkdtempSync(join(tmpdir(), 'eventlog-spike-'))
const file = (name: string) => join(dir, `${name}.db`)

const check = (label: string, ok: boolean, detail: unknown) =>
  ok
    ? Effect.log(`PASS ${label}`)
    : Effect.die(`FAIL ${label}: ${JSON.stringify(detail)}`)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const startServer = Effect.forkScoped(
  Layer.launch(serverLayer({ port: PORT, file: file('server') })),
)

const serverMastery = readMastery.pipe(
  Effect.provide(SqliteClient.layer({ filename: file('server') })),
)

const buildDevice = (name: string, identity: EventLog.Identity['Service']) =>
  Layer.build(deviceLayer({ file: file(name), identity }))

const program = Effect.gen(function* () {
  yield* Effect.log(`files in ${dir}`)
  const identity = yield* EventLog.makeIdentity.pipe(
    Effect.provide(EventLogEncryption.layerSubtle),
  )

  let server = yield* startServer
  const laptop = yield* buildDevice('laptop', identity)
  const phone = yield* buildDevice('phone', identity)

  yield* gainMastery(laptop, {
    runId: 'run-1',
    heroes: { Cook: 10 },
    guns: { Pistol: 5 },
  })
  yield* gainMastery(phone, {
    runId: 'run-2',
    heroes: { Cook: 3 },
    guns: { Shotgun: 2 },
  })

  const expected1 = { heroes: { Cook: 13 }, guns: { Pistol: 5, Shotgun: 2 } }
  yield* goOnline(laptop, URL)
  const phoneOnline = yield* Scope.make()
  yield* goOnline(phone, URL).pipe(Scope.provide(phoneOnline))
  yield* waitForEntries(2, laptop, phone)
  const laptop1 = yield* masteryOf(laptop)
  const phone1 = yield* masteryOf(phone)
  yield* check('offline writes merge on both devices', same(laptop1, expected1) && same(phone1, expected1), { laptop1, phone1 })
  yield* Effect.sleep('200 millis')
  const server1 = yield* serverMastery
  yield* check('server projection matches', same(server1, expected1), server1)

  yield* Fiber.interrupt(server)
  yield* Effect.log('server down (like a Durable Object evicted)')
  yield* gainMastery(laptop, {
    runId: 'run-3',
    heroes: {},
    guns: { Pistol: 1 },
  })
  yield* Effect.sleep('1 second')
  server = yield* startServer
  yield* Effect.log('server back up on the same database')
  yield* waitForEntries(3, laptop, phone)
  const expected2 = { heroes: { Cook: 13 }, guns: { Pistol: 6, Shotgun: 2 } }
  const phone2 = yield* masteryOf(phone)
  yield* check('a write made while the server was down reaches the other device', same(phone2, expected2), phone2)

  yield* Scope.close(phoneOnline, undefined as never)
  const reloaded = yield* buildDevice('phone', identity)
  const reloaded2 = yield* masteryOf(reloaded)
  const reloadedCount = yield* entriesOf(reloaded)
  yield* check('a reloaded device keeps its journal and does not count twice', same(reloaded2, expected2) && reloadedCount === 3, { reloaded2, reloadedCount })
  yield* goOnline(reloaded, URL)
  yield* Effect.sleep('500 millis')
  const reloaded3 = yield* masteryOf(reloaded)
  yield* check('going online again replays nothing twice', same(reloaded3, expected2), reloaded3)

  const intruderIdentity = yield* EventLog.makeIdentity.pipe(
    Effect.provide(EventLogEncryption.layerSubtle),
  )
  const intruder = yield* Layer.build(
    deviceLayer({ file: file('intruder'), identity: intruderIdentity }),
  )
  yield* gainMastery(intruder, {
    runId: 'evil',
    heroes: { Cook: 9999 },
    guns: {},
  }).pipe(
    Effect.provideService(
      EventLog.CurrentStoreId,
      EventLogMessage.StoreId.make(playerStoreOf(identity.publicKey)),
    ),
  )
  yield* goOnline(intruder, URL).pipe(
    Effect.provideService(
      EventLog.CurrentStoreId,
      EventLogMessage.StoreId.make(playerStoreOf(identity.publicKey)),
    ),
  )
  yield* Effect.sleep('1 second')
  const laptopAfter = yield* masteryOf(laptop)
  yield* check("another identity cannot write a player's store", same(laptopAfter, expected2), laptopAfter)
  yield* Effect.log('ALL PASSED')
})

BunRuntime.runMain(program.pipe(Effect.scoped, Effect.timeout('40 seconds')))
