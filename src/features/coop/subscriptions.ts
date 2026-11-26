import { Clock, Effect, Option, Stream } from 'effect'

import { Subscription } from '@effect/ui'

import { Screen, maybeRoomOf } from '#domain/coopRoom.ts'

import { CoopMessage } from './message.ts'
import { type Model } from './model.ts'
import { CoopNet } from './net.ts'

const overNet = <A>(
  toStream: (net: CoopNet['Service']) => Stream.Stream<A>,
): Stream.Stream<A, never, CoopNet> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const net = yield* CoopNet
      return toStream(net)
    }),
  )

const quickPlay = (model: Model) =>
  Subscription.make(
    'CoopQuickPlay',
    [model.name, model.look, model.rank, model.calling, model.introSeen],
    ([name, look, rank, calling, introSeen]) =>
      overNet(net =>
        Stream.map(net.quickPlay(name, look, rank, calling, introSeen), event =>
          CoopMessage.ReceivedQuickPlayEvent({ event }),
        ),
      ),
  )

const lobby = (code: string) =>
  Subscription.make('CoopLobby', code, deps =>
    overNet(net =>
      Stream.map(net.lobby(deps), event =>
        CoopMessage.ReceivedLobbyEvent({ event }),
      ),
    ),
  )

const room = (code: string) =>
  Subscription.make('CoopRoom', code, deps =>
    overNet(net =>
      Stream.mapEffect(net.room(deps), event =>
        Effect.map(Clock.currentTimeMillis, atMs =>
          CoopMessage.ReceivedRoomEvent({ event, atMs }),
        ),
      ),
    ),
  )

export const coopSubscriptions = (model: Model) => {
  const maybeCode = Option.map(maybeRoomOf(model), ({ code }) => code)
  return [
    Screen.$is('Queue')(model.screen) && quickPlay(model),
    Option.isSome(maybeCode) && lobby(maybeCode.value),
    Option.isSome(maybeCode) && room(maybeCode.value),
  ] as const
}
