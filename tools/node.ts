import { type Effect, ManagedRuntime, Stream } from 'effect'

import * as NodeServices from '@effect/platform-node/NodeServices'

// NOTE: Vite calls a plugin's hooks outside any Effect, so each hook runs
// its Effect on this runtime, with Node's file system, paths, and processes.
/** @stability unstable */
export const nodeRuntime = ManagedRuntime.make(NodeServices.layer)

// NOTE: a child process's output stream as text.
export const textOf = <E>(
  stream: Stream.Stream<Uint8Array, E>,
): Effect.Effect<string, E> => Stream.mkString(Stream.decodeText(stream))
