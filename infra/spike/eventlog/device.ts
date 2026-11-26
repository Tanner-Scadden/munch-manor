import { Context, Effect, Layer, Schedule } from 'effect'
import {
  EventLog,
  EventLogMessage,
  EventLogRemote,
  SqlEventJournal,
} from 'effect/eventlog'
import { RpcClient, RpcSerialization } from 'effect/rpc'
import { SqlClient } from 'effect/sql'
import { Socket } from 'effect/socket'

import { SqliteClient } from '@effect/sql-sqlite-bun'

import {
  MasteryHandlers,
  createMasteryTables,
  masterySchema,
  readMastery,
} from './mastery.ts'
import { playerStoreOf } from './serverParts.ts'

export type Device = Context.Context<
  EventLog.EventLog | EventLog.Registry | SqlClient.SqlClient
>

export const deviceLayer = (options: {
  file: string
  identity: EventLog.Identity['Service']
}) =>
  EventLog.layer(masterySchema, MasteryHandlers).pipe(
    Layer.provide(SqlEventJournal.layer()),
    Layer.provide(Layer.effectDiscard(createMasteryTables)),
    Layer.provide(Layer.succeed(EventLog.Identity, options.identity)),
    Layer.provide(
      Layer.succeed(
        EventLog.CurrentStoreId,
        EventLogMessage.StoreId.make(playerStoreOf(options.identity.publicKey)),
      ),
    ),
    Layer.provideMerge(SqliteClient.layer({ filename: options.file })),
  )

export const remoteLayer = (url: string) =>
  EventLogRemote.layerUnencrypted.pipe(
    Layer.provide(RpcClient.layerProtocolSocket({ retryTransientErrors: true })),
    Layer.provide(Socket.layerWebSocket(url)),
    Layer.provide(Socket.layerWebSocketConstructorGlobal),
    Layer.provide(RpcSerialization.layerSchemaBinary()),
  )

export const goOnline = (device: Device, url: string) =>
  Layer.build(remoteLayer(url).pipe(Layer.provide(Layer.succeedContext(device))))

export const gainMastery = (
  device: Device,
  payload: {
    runId: string
    heroes: Record<string, number>
    guns: Record<string, number>
  },
) =>
  Effect.gen(function* () {
    const client = yield* EventLog.makeClient(masterySchema)
    yield* client({ event: 'GainedMastery', payload })
  }).pipe(Effect.provideContext(device))

export const masteryOf = (device: Device) =>
  readMastery.pipe(Effect.provideContext(device))

export const entriesOf = (device: Device) =>
  EventLog.EventLog.use(log => log.entries).pipe(
    Effect.map(entries => entries.length),
    Effect.provideContext(device),
  )

export const waitForEntries = (count: number, ...devices: ReadonlyArray<Device>) =>
  Effect.forEach(devices, entriesOf).pipe(
    Effect.repeat({
      until: counts => counts.every(c => c === count),
      schedule: Schedule.spaced('50 millis'),
    }),
    Effect.timeoutOrElse({
      duration: '10 seconds',
      orElse: () =>
        Effect.flatMap(Effect.forEach(devices, entriesOf), counts =>
          Effect.die(`devices did not reach ${count} entries: ${counts}`),
        ),
    }),
    Effect.asVoid,
  )
