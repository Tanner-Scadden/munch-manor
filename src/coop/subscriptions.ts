import { Clock, Effect, Option, Schema, Stream } from 'effect'

import { makeSubscriptions } from './definition'
import { Message } from './message'
import { type Model, Screen } from './model'
import { CoopNet } from './net'
import { maybeRoomOf } from './roomState'

// NOTE: co-op's streams, each running while the Model needs it: the QUICK
// PLAY socket while queued, and the lobby and the game socket while in a
// room. Ending a stream closes its socket. The room's frame clock is the
// root's (src/subscriptions.ts), which ticks the room through its Binding.

const MaybeJoiner = Schema.Option(
  Schema.Struct({ name: Schema.String, look: Schema.String }),
)
const MaybeCode = Schema.Option(Schema.String)

const maybeQueueJoiner = (
  model: Model,
): Option.Option<Readonly<{ name: string; look: string }>> =>
  Screen.isAnyOf(['Queue'])(model.screen)
    ? Option.some({ name: model.name, look: model.look })
    : Option.none()

const maybeRoomCode = (model: Model): Option.Option<string> =>
  Option.map(maybeRoomOf(model), room => room.code)

const whenSome = <A, B>(
  maybeValue: Option.Option<A>,
  toStream: (value: A) => Stream.Stream<B>,
): Stream.Stream<B> =>
  Option.match(maybeValue, { onNone: () => Stream.empty, onSome: toStream })

export const subscriptions = makeSubscriptions(entry => ({
  quickPlay: entry(
    'QuickPlay',
    { maybeJoiner: MaybeJoiner },
    {
      messages: [Message.ReceivedQuickPlayEvent],
      modelToDependencies: model => ({
        maybeJoiner: maybeQueueJoiner(model),
      }),
      handler: function* () {
        const net = yield* CoopNet
        return ({ maybeJoiner }) =>
          whenSome(maybeJoiner, ({ name, look }) =>
            Stream.map(net.quickPlay(name, look), event =>
              Message.ReceivedQuickPlayEvent({ event }),
            ),
          )
      },
    },
  ),

  lobby: entry(
    'Lobby',
    { maybeCode: MaybeCode },
    {
      messages: [Message.ReceivedLobbyEvent],
      modelToDependencies: model => ({ maybeCode: maybeRoomCode(model) }),
      handler: function* () {
        const net = yield* CoopNet
        return ({ maybeCode }) =>
          whenSome(maybeCode, code =>
            Stream.map(net.lobby(code), event =>
              Message.ReceivedLobbyEvent({ event }),
            ),
          )
      },
    },
  ),

  room: entry(
    'Room',
    { maybeCode: MaybeCode },
    {
      messages: [Message.ReceivedRoomEvent],
      modelToDependencies: model => ({ maybeCode: maybeRoomCode(model) }),
      handler: function* () {
        const net = yield* CoopNet
        return ({ maybeCode }) =>
          whenSome(maybeCode, code =>
            Stream.mapEffect(net.room(code), event =>
              Effect.map(Clock.currentTimeMillis, atMs =>
                Message.ReceivedRoomEvent({ event, atMs }),
              ),
            ),
          )
      },
    },
  ),
}))
