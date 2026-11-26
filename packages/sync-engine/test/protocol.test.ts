import { Effect, Exit } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import {
  ClientMessageJson,
  ServerMessageJson,
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from '../src/index'

describe('the wire protocol', () => {
  it.effect('client and server messages round trip as JSON', () =>
    Effect.gen(function* () {
      const hello = {
        _tag: 'Hello' as const,
        protocol: 1,
        scope: 'player:abc',
        lastSeq: 3,
        mode: 'Catchup' as const,
        clientId: 'tab',
        token: 'token',
        versions: { ChangedSettings: 1 },
      }
      const json = yield* encodeClientMessage(hello)
      const value_4 = yield* decodeClientMessage(json)
      expect(value_4).toEqual(hello)
      const ack = { _tag: 'Acked' as const, id: 'mutation-0001', seq: 4 }
      const value_6 = yield* encodeServerMessage(ack)
      const value_5 = yield* decodeServerMessage(value_6)
      expect(value_5).toEqual(ack)
      expect(ClientMessageJson).toBeDefined()
      expect(ServerMessageJson).toBeDefined()
    }),
  )

  it.effect('malformed messages are refused', () =>
    Effect.gen(function* () {
      const bad = yield* Effect.exit(
        decodeClientMessage('{"_tag":"Push","mutations":[{"id":"x"}]}'),
      )
      const shortId = yield* Effect.exit(
        decodeServerMessage('{"_tag":"Acked","id":"short","seq":1}'),
      )
      const notJson = yield* Effect.exit(decodeClientMessage('nope'))
      expect(Exit.isFailure(bad)).toBe(true)
      expect(Exit.isFailure(shortId)).toBe(true)
      expect(Exit.isFailure(notJson)).toBe(true)
    }),
  )
})
