import { Effect, Function, pipe } from 'effect'

import {
  ChangedMemberCalling,
  ChangedMemberName,
  ChangedModifiers,
  ChangedPicks,
  ChangedReady,
  KickedPlayer,
  LeftRoom,
} from '@munch/netcode'
import type { Mutation } from '@munch/sync-engine'

import { type CoopProblem, LobbyChange } from './model'

// NOTE: a lobby change as the room scope's mutation, written through either
// way to the lobby: the leader tab's own Replica (src/features/coop/roomReplica.ts) or
// a follower tab's socket (src/features/coop/net.ts).

/** @stability unstable */
export type LobbyWriter<E> = <A, I>(
  mutation: Mutation<string, A, I>,
  args: NoInfer<A>,
) => Effect.Effect<string, E>

/** @stability unstable */
export const writeLobbyChange: {
  (
    by: string,
    change: LobbyChange | 'Left',
  ): <E>(write: LobbyWriter<E>) => Effect.Effect<void, CoopProblem>
  <E>(
    write: LobbyWriter<E>,
    by: string,
    change: LobbyChange | 'Left',
  ): Effect.Effect<void, CoopProblem>
} = Function.dual(
  3,
  <E>(
    write: LobbyWriter<E>,
    by: string,
    change: LobbyChange | 'Left',
  ): Effect.Effect<void, CoopProblem> =>
    pipe(
      change === 'Left'
        ? write(LeftRoom, { by })
        : LobbyChange.match(change, {
            ChangedReady: ({ ready, pingMs }) =>
              write(ChangedReady, {
                by,
                ready,
                pingMs: Math.max(0, Math.min(60_000, Math.round(pingMs))),
              }),
            ChangedMemberCalling: ({ calling }) =>
              write(ChangedMemberCalling, { by, calling }),
            ChangedMemberName: ({ name }) =>
              write(ChangedMemberName, { by, name }),
            ChangedPicks: ({ mode, difficulty }) =>
              write(ChangedPicks, { by, mode, difficulty }),
            ChangedModifiers: ({ modifiers }) =>
              write(ChangedModifiers, { by, modifiers }),
            KickedPlayer: ({ playerId }) =>
              write(KickedPlayer, { by, playerId }),
          }),
      Effect.asVoid,
      Effect.mapError((): CoopProblem => 'Offline'),
    ),
)
