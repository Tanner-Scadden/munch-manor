import { Effect, Layer } from 'effect'
import { EventLogServerUnencrypted } from 'effect/eventlog'

import { MasteryHandlers, createMasteryTables } from './mastery.ts'

export const playerStoreOf = (publicKey: string) => `player:${publicKey}`

const forbidden = (message: string) =>
  new EventLogServerUnencrypted.EventLogServerAuthError({
    reason: 'Forbidden',
    publicKey: undefined,
    message,
  } as never)

const ownerOnly = (publicKey: string, storeId: string) =>
  storeId === playerStoreOf(publicKey)
    ? Effect.void
    : Effect.fail(forbidden(`${publicKey} may not use ${storeId}`))

export const AuthorizationLayer = Layer.succeed(
  EventLogServerUnencrypted.EventLogServerAuthorization,
  {
    authorizeWrite: ({ publicKey, storeId }) => ownerOnly(publicKey, storeId),
    authorizeRead: ({ publicKey, storeId }) => ownerOnly(publicKey, storeId),
    authorizeIdentity: () => Effect.void,
  },
)

export const storeMappingLayer = (isHere: (storeId: string) => boolean) =>
  Layer.succeed(EventLogServerUnencrypted.StoreMapping, {
    resolve: ({ storeId, publicKey }) =>
      isHere(storeId)
        ? Effect.succeed(storeId)
        : Effect.fail(
            new EventLogServerUnencrypted.EventLogServerStoreError({
              reason: 'NotFound',
              publicKey,
              storeId,
              message: `${storeId} does not live here`,
            } as never),
          ),
    hasStore: ({ storeId }) => Effect.succeed(isHere(storeId)),
  })

export const ServerHandlersLayer = Layer.effectDiscard(createMasteryTables).pipe(
  Layer.provideMerge(MasteryHandlers),
)
