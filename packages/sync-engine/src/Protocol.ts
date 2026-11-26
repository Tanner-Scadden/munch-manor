import { Schema } from 'effect'

export const PROTOCOL_VERSION = 1

export const MutationId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{8,64}$/),
)
export type MutationId = typeof MutationId.Type

export const RowValue = Schema.Union([
  Schema.Null,
  Schema.Finite,
  Schema.String,
])
export type RowValue = typeof RowValue.Type

export const Row = Schema.Record(Schema.String, RowValue)
export type Row = typeof Row.Type

export const Envelope = Schema.Struct({
  id: MutationId,
  name: Schema.String,
  version: Schema.Finite,
  args: Schema.String,
})
export type Envelope = typeof Envelope.Type

export const Origin = Schema.Literals(['Client', 'Server'])
export type Origin = typeof Origin.Type

export const Delta = Schema.Struct({
  seq: Schema.Finite,
  id: MutationId,
  name: Schema.String,
  version: Schema.Finite,
  args: Schema.String,
  timestampMs: Schema.Finite,
  origin: Origin,
})
export type Delta = typeof Delta.Type

export const RejectCode = Schema.Literals([
  'UnknownMutation',
  'Outdated',
  'Forbidden',
  'InvalidArgs',
  'Precondition',
  'Unavailable',
])
export type RejectCode = typeof RejectCode.Type

export const FailCode = Schema.Literals([
  'Unauthorized',
  'Forbidden',
  'VersionMismatch',
  'BadMessage',
  'NotReady',
  'Unavailable',
])
export type FailCode = typeof FailCode.Type

export const HelloMode = Schema.Literals(['Catchup', 'Snapshot'])
export type HelloMode = typeof HelloMode.Type

export const ClientMessage = Schema.TaggedUnion({
  Hello: {
    protocol: Schema.Finite,
    scope: Schema.String,
    lastSeq: Schema.Finite,
    mode: HelloMode,
    clientId: Schema.String,
    token: Schema.String,
    versions: Schema.Record(Schema.String, Schema.Finite),
  },
  Push: { mutations: Schema.Array(Envelope) },
  Ping: {},
})
export type ClientMessage = typeof ClientMessage.Type
export type HelloMessage = typeof ClientMessage.cases.Hello.Type

export const ServerMessage = Schema.TaggedUnion({
  Snapshot: {
    scope: Schema.String,
    seq: Schema.Finite,
    tables: Schema.Record(Schema.String, Schema.Array(Row)),
  },
  Deltas: {
    scope: Schema.String,
    head: Schema.Finite,
    deltas: Schema.Array(Delta),
  },
  Acked: { id: MutationId, seq: Schema.Finite },
  Rejected: { id: MutationId, code: RejectCode, reason: Schema.String },
  Failed: { code: FailCode, reason: Schema.String },
  Pong: {},
})
export type ServerMessage = typeof ServerMessage.Type
export type SnapshotMessage = typeof ServerMessage.cases.Snapshot.Type
export type DeltasMessage = typeof ServerMessage.cases.Deltas.Type
export type AckedMessage = typeof ServerMessage.cases.Acked.Type
export type RejectedMessage = typeof ServerMessage.cases.Rejected.Type

export const Exchange = Schema.Array(ClientMessage)
export type Exchange = typeof Exchange.Type

export const ExchangeReply = Schema.Array(ServerMessage)
export type ExchangeReply = typeof ExchangeReply.Type

export const ClientMessageJson = Schema.fromJsonString(ClientMessage)
export const ServerMessageJson = Schema.fromJsonString(ServerMessage)
export const ExchangeJson = Schema.fromJsonString(Exchange)
export const ExchangeReplyJson = Schema.fromJsonString(ExchangeReply)

const decodeClientMessageWith = Schema.decodeUnknownEffect(ClientMessageJson)
export const decodeClientMessage = (input: unknown) =>
  decodeClientMessageWith(input)
const encodeClientMessageWith = Schema.encodeEffect(ClientMessageJson)
export const encodeClientMessage = (input: ClientMessage) =>
  encodeClientMessageWith(input)
const decodeServerMessageWith = Schema.decodeUnknownEffect(ServerMessageJson)
export const decodeServerMessage = (input: unknown) =>
  decodeServerMessageWith(input)
const encodeServerMessageWith = Schema.encodeEffect(ServerMessageJson)
export const encodeServerMessage = (input: ServerMessage) =>
  encodeServerMessageWith(input)
const decodeExchangeWith = Schema.decodeUnknownEffect(ExchangeJson)
export const decodeExchange = (input: unknown) => decodeExchangeWith(input)
const encodeExchangeWith = Schema.encodeEffect(ExchangeJson)
export const encodeExchange = (input: Exchange) => encodeExchangeWith(input)
const decodeExchangeReplyWith = Schema.decodeUnknownEffect(ExchangeReplyJson)
export const decodeExchangeReply = (input: unknown) =>
  decodeExchangeReplyWith(input)
const encodeExchangeReplyWith = Schema.encodeEffect(ExchangeReplyJson)
export const encodeExchangeReply = (input: ExchangeReply) =>
  encodeExchangeReplyWith(input)

export const PING_JSON = '{"_tag":"Ping"}'
export const PONG_JSON = '{"_tag":"Pong"}'

export const SCOPE_PATHS = {
  socket: '/sync/socket',
  exchange: '/sync/exchange',
}
