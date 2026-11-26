import { Effect, Schema } from 'effect'
import { EventLog, EventLogEncryption, EventLogMessage } from 'effect/eventlog'
import { Rpc, RpcGroup } from 'effect/rpc'

export const PLAYER_LOG_PATH = '/eventlog'

export const LINK_REDEEM_PATH = '/link/redeem'

export const playerStoreOf = (publicKey: string) => `player:${publicKey}`

export const SessionToken = Schema.Struct({
  token: Schema.String,
  expiresMs: Schema.Finite,
})
export type SessionToken = typeof SessionToken.Type

export const LinkCode = Schema.Struct({
  code: Schema.String,
  expiresMs: Schema.Finite,
})
export type LinkCode = typeof LinkCode.Type

export const SessionProblem = Schema.Literals([
  'NotSignedIn',
  'WrongCode',
  'TooManyTries',
  'Unavailable',
])
export type SessionProblem = typeof SessionProblem.Type

export class SessionRefused extends Schema.TaggedError<
  SessionRefused,
  { readonly brand: unique symbol }
>()('SessionRefused', { problem: SessionProblem }) {}

class MintSessionRpc extends Rpc.make('Session.Mint', {
  success: SessionToken,
  error: SessionRefused,
}) {}

class CreateLinkCodeRpc extends Rpc.make('Session.CreateLinkCode', {
  payload: { identity: Schema.String },
  success: LinkCode,
  error: SessionRefused,
}) {}

export class SessionRpcs extends RpcGroup.make(
  MintSessionRpc,
  CreateLinkCodeRpc,
) {}

export const PlayerLogRpcs =
  EventLogMessage.EventLogRemoteRpcs.merge(SessionRpcs)

export const RedeemRequest = Schema.Struct({ code: Schema.String })
export type RedeemRequest = typeof RedeemRequest.Type

export const RedeemAnswer = Schema.TaggedUnion({
  Redeemed: { identity: Schema.String },
  Refused: { problem: SessionProblem },
})
export type RedeemAnswer = typeof RedeemAnswer.Type

export const newIdentity: Effect.Effect<EventLog.Identity['Service']> =
  Effect.flatMap(
    EventLogEncryption.makeEncryptionSubtle(globalThis.crypto),
    encryption =>
      Effect.provideService(
        EventLog.makeIdentity,
        EventLogEncryption.EventLogEncryption,
        encryption,
      ),
  )
