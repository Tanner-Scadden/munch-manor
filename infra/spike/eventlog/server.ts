import { Layer } from 'effect'
import {
  EventLogServerUnencrypted,
  SqlEventLogServerUnencrypted,
} from 'effect/eventlog'
import { HttpRouter } from 'effect/http'
import { RpcSerialization, RpcServer } from 'effect/rpc'

import { BunHttpServer } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'

import { masterySchema } from './mastery.ts'
import {
  AuthorizationLayer,
  ServerHandlersLayer,
  storeMappingLayer,
} from './serverParts.ts'

export const serverLayer = (options: { port: number; file: string }) =>
  EventLogServerUnencrypted.layer(masterySchema, ServerHandlersLayer).pipe(
    Layer.provide([
      AuthorizationLayer,
      storeMappingLayer(() => true),
      SqlEventLogServerUnencrypted.layerStorage(),
    ]),
    Layer.provide(RpcServer.layerProtocolWebsocket({ path: '/sync' })),
    Layer.provide(RpcSerialization.layerSchemaBinary()),
    HttpRouter.serve,
    Layer.provide(BunHttpServer.layer({ port: options.port })),
    Layer.provide(SqliteClient.layer({ filename: options.file })),
  )
