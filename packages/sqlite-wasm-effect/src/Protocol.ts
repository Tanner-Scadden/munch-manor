import { Schema } from 'effect'

// VALUES

export const SqlValue = Schema.Union([
  Schema.Null,
  Schema.Finite,
  Schema.String,
  Schema.BigInt,
  Schema.Uint8Array,
])
export type SqlValue = typeof SqlValue.Type

export const ChangeOperation = Schema.Literals(['Insert', 'Update', 'Delete'])
export type ChangeOperation = typeof ChangeOperation.Type

export const TableChange = Schema.Struct({
  table: Schema.String,
  operation: ChangeOperation,
})
export type TableChange = typeof TableChange.Type

// NOTE: Memory carries why the database could not live in OPFS, such as a
// private window or a browser without sync access handles.
export const Persistence = Schema.TaggedUnion({
  Opfs: {},
  Memory: { reason: Schema.String },
})
export type Persistence = typeof Persistence.Type

export const DatabaseFailure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
})
export type DatabaseFailure = typeof DatabaseFailure.Type

// REQUESTS

// NOTE: a session is one tab's connection. The worker lets one session at a
// time hold an open transaction and queues the others behind it.
export const Request = Schema.TaggedUnion({
  Open: {
    id: Schema.String,
    session: Schema.String,
    file: Schema.String,
    directory: Schema.String,
  },
  Execute: {
    id: Schema.String,
    session: Schema.String,
    sql: Schema.String,
    params: Schema.Array(SqlValue),
  },
  Cancel: { id: Schema.String, session: Schema.String },
  Release: { session: Schema.String },
})
export type Request = typeof Request.Type
export type Execute = typeof Request.cases.Execute.Type
export type Open = typeof Request.cases.Open.Type

// RESPONSES

export const Response = Schema.TaggedUnion({
  Opened: { id: Schema.String, persistence: Persistence },
  OpenFailed: { id: Schema.String, failure: DatabaseFailure },
  Rows: {
    id: Schema.String,
    columns: Schema.Array(Schema.String),
    values: Schema.Array(Schema.Array(SqlValue)),
  },
  Failed: { id: Schema.String, failure: DatabaseFailure },
  Changed: { changes: Schema.Array(TableChange) },
})
export type Response = typeof Response.Type

// BETWEEN TABS

// NOTE: followers Ask the leader tab over a BroadcastChannel and read the
// Answers whose ids they are waiting on. A new leader says LeaderChanged so
// followers stop waiting on the old one.
export const ChannelMessage = Schema.TaggedUnion({
  Ask: { request: Request },
  Answer: { response: Response },
  LeaderChanged: { leader: Schema.String },
})
export type ChannelMessage = typeof ChannelMessage.Type

const decodeRequestWith = Schema.decodeUnknownEffect(Request)
export const decodeRequest = (input: unknown) => decodeRequestWith(input)
const encodeRequestWith = Schema.encodeEffect(Request)
export const encodeRequest = (input: Request) => encodeRequestWith(input)
const decodeResponseWith = Schema.decodeUnknownEffect(Response)
export const decodeResponse = (input: unknown) => decodeResponseWith(input)
const encodeResponseWith = Schema.encodeEffect(Response)
export const encodeResponse = (input: Response) => encodeResponseWith(input)
const decodeChannelMessageWith = Schema.decodeUnknownEffect(ChannelMessage)
export const decodeChannelMessage = (input: unknown) =>
  decodeChannelMessageWith(input)
const encodeChannelMessageWith = Schema.encodeEffect(ChannelMessage)
export const encodeChannelMessage = (input: ChannelMessage) =>
  encodeChannelMessageWith(input)
