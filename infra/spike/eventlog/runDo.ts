import { Effect, Layer, Schedule } from 'effect'
import { EventLog, EventLogEncryption, EventLogMessage } from 'effect/eventlog'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BunRuntime } from '@effect/platform-bun'

import {
  deviceLayer,
  entriesOf,
  gainMastery,
  goOnline,
  masteryOf,
  waitForEntries,
} from './device.ts'
import { playerStoreOf } from './serverParts.ts'

const PORT = 8792
const REMOTE = process.env["REMOTE"]
const IDLE_SECONDS = Number(process.env['IDLE_SECONDS'] ?? '15')
const here = import.meta.dirname
const infra = resolve(here, '../..')
const dir = mkdtempSync(join(tmpdir(), 'eventlog-do-'))
const storage = join(dir, 'storage')
mkdirSync(storage)

const config = `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "main", worker = .api),
    (name = "do-storage", disk = (path = "${storage}", writable = true)),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:${PORT}", http = (), service = "main") ],
);
const api :Workerd.Worker = (
  modules = [ (name = "worker", esModule = embed "worker.js") ],
  compatibilityDate = "2026-10-01",
  bindings = [ (name = "EVENTLOG", durableObjectNamespace = "EventLogStore") ],
  durableObjectNamespaces = [
    (className = "EventLogStore", uniqueKey = "eventlog-spike", enableSql = true),
  ],
  durableObjectStorage = (localDisk = "do-storage"),
);
`

const build = Effect.promise(() =>
  Bun.build({
    entrypoints: [join(here, 'worker.ts')],
    outdir: dir,
    target: 'browser',
    format: 'esm',
    naming: 'worker.js',
  }),
).pipe(
  Effect.flatMap(result =>
    result.success ? Effect.void : Effect.die(result.logs.join('\n')),
  ),
  Effect.tap(() => Effect.sync(() => writeFileSync(join(dir, 'config.capnp'), config))),
)

let running: ReturnType<typeof Bun.spawn> | undefined
const spawn = Effect.sync(() => {
  running = Bun.spawn(
    [join(infra, 'node_modules/.bin/workerd'), 'serve', 'config.capnp', '--experimental'],
    { cwd: dir, stdout: 'inherit', stderr: 'inherit' },
  )
})
const kill = Effect.promise(async () => {
  running?.kill(9)
  await running?.exited
})

const check = (label: string, ok: boolean, detail: unknown) =>
  ok ? Effect.log(`PASS ${label}`) : Effect.die(`FAIL ${label}: ${JSON.stringify(detail)}`)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const program = Effect.gen(function* () {
  if (REMOTE === undefined) {
    yield* build
    yield* spawn
    yield* Effect.addFinalizer(() => kill)
  }

  const identity = yield* EventLog.makeIdentity.pipe(
    Effect.provide(EventLogEncryption.layerSubtle),
  )
  const store = playerStoreOf(identity.publicKey)
  const host = REMOTE ?? `127.0.0.1:${PORT}`
  const secure = REMOTE === undefined ? "" : "s"
  const base = `${host}/eventlog/${encodeURIComponent(store)}`
  const url = `ws${secure}://${base}`
  const activation = Effect.tryPromise(() =>
    fetch(`http${secure}://${base}/activation`).then(r =>
      r.ok ? r.text() : r.text().then(t => Promise.reject(new Error(t))),
    ),
  ).pipe(Effect.retry({ schedule: Schedule.spaced('100 millis'), times: 100 }))
  yield* activation

  const laptop = yield* Layer.build(deviceLayer({ file: join(dir, 'laptop.db'), identity }))
  const phone = yield* Layer.build(deviceLayer({ file: join(dir, 'phone.db'), identity }))
  yield* gainMastery(laptop, { runId: 'run-1', heroes: { Cook: 10 }, guns: { Pistol: 5 } })
  yield* gainMastery(phone, { runId: 'run-2', heroes: { Cook: 3 }, guns: { Shotgun: 2 } })
  yield* goOnline(laptop, url)
  yield* goOnline(phone, url)
  yield* waitForEntries(2, laptop, phone)
  const expected1 = { heroes: { Cook: 13 }, guns: { Pistol: 5, Shotgun: 2 } }
  const laptop1 = yield* masteryOf(laptop)
  const phone1 = yield* masteryOf(phone)
  yield* check('DO: offline writes merge on both devices', same(laptop1, expected1) && same(phone1, expected1), { laptop1, phone1 })

  const before = yield* activation
  yield* Effect.log(`idle ${IDLE_SECONDS}s with both sockets open (activation ${before})`)
  yield* Effect.sleep(`${IDLE_SECONDS} seconds`)
  yield* gainMastery(laptop, { runId: 'run-3', heroes: {}, guns: { Pistol: 1 } })
  yield* waitForEntries(3, laptop, phone)
  const after = yield* activation
  yield* Effect.log(`activation after idle: ${after} (${before === after ? 'same instance, no hibernation' : 'woke a new instance'})`)
  const phone2 = yield* masteryOf(phone)
  const expected2 = { heroes: { Cook: 13 }, guns: { Pistol: 6, Shotgun: 2 } }
  yield* check('DO: a write after idling reaches the other device', same(phone2, expected2), phone2)

  if (REMOTE !== undefined) {
    yield* Effect.log('ALL PASSED (remote: skipped the reset step)')
    return
  }
  yield* kill
  yield* Effect.log('workerd killed (Durable Object reset)')
  yield* gainMastery(phone, { runId: 'run-4', heroes: { Medic: 4 }, guns: {} })
  yield* Effect.sleep('1 second')
  yield* spawn
  yield* activation
  yield* Effect.log('workerd back on the same storage')
  yield* waitForEntries(4, laptop, phone)
  const laptop3 = yield* masteryOf(laptop)
  const expected3 = { heroes: { Cook: 13, Medic: 4 }, guns: { Pistol: 6, Shotgun: 2 } }
  yield* check('DO: a write made while the object was down reaches the other device', same(laptop3, expected3), laptop3)

  const intruderIdentity = yield* EventLog.makeIdentity.pipe(
    Effect.provide(EventLogEncryption.layerSubtle),
  )
  const intruder = yield* Layer.build(
    deviceLayer({ file: join(dir, 'intruder.db'), identity: intruderIdentity }),
  )
  const theirStore = EventLogMessage.StoreId.make(store)
  yield* gainMastery(intruder, { runId: 'evil', heroes: { Cook: 9999 }, guns: {} }).pipe(
    Effect.provideService(EventLog.CurrentStoreId, theirStore),
  )
  yield* goOnline(intruder, url).pipe(
    Effect.provideService(EventLog.CurrentStoreId, theirStore),
  )
  const ownStore = playerStoreOf(intruderIdentity.publicKey)
  const mislaid = yield* Layer.build(
    deviceLayer({ file: join(dir, 'mislaid.db'), identity: intruderIdentity }),
  )
  yield* gainMastery(mislaid, { runId: 'mislaid', heroes: { Cook: 7 }, guns: {} })
  yield* goOnline(mislaid, url)
  yield* Effect.sleep('2 seconds')
  const laptop4 = yield* masteryOf(laptop)
  const count = yield* entriesOf(laptop)
  yield* check("DO: another identity cannot write a player's store, even on its socket", same(laptop4, expected3) && count === 4, { laptop4, count, ownStore })
  yield* Effect.log('ALL PASSED')
})

BunRuntime.runMain(program.pipe(Effect.scoped, Effect.timeout(`${IDLE_SECONDS + 60} seconds`)))
