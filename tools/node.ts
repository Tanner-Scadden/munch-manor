import { type Effect, ManagedRuntime, Stream } from 'effect'

import * as NodeServices from '@effect/platform-node/NodeServices'

export const nodeRuntime = ManagedRuntime.make(NodeServices.layer)

export const textOf = <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E> => Stream.mkString(Stream.decodeText(stream))
