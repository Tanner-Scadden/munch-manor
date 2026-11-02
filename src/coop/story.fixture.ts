import { Array, Option, Schema } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { Message } from './message'
import {
  LobbyChange,
  type Model,
  type Room,
  Screen,
  initialModel,
} from './model'
import { freshRoom, maybeRoomOf } from './roomState'
import { CODE, type lobbyOf } from './testing'
import { open, pressKey } from './update'

// What the co-op Story tests start from: a player on the hub with one hero
// bought, a room around them, and the lobby's changes read back off a key.

export const onHub: Model = open(
  initialModel,
  '',
  Option.none(),
  '',
  1,
  'You',
  ['hero:Handyman'],
).model

export const roomOf = (current: Model): Room =>
  Option.getOrThrow(maybeRoomOf(current))

export const inRoom = (slot: number): Model =>
  modifyFields(onHub, {
    screen: () => Screen.InRoom({ room: freshRoom(CODE, slot) }),
  })

export const lobbyUpdate = (lobby: ReturnType<typeof lobbyOf>) =>
  Message.ReceivedLobbyEvent({ event: { _tag: 'Updated', lobby } })

const decodeChange = Schema.decodeUnknownOption(
  Schema.Struct({ change: LobbyChange }),
)

export const picked = (current: Model, code: string) =>
  Array.flatMap(pressKey(current, code).commands ?? [], command =>
    Option.match(decodeChange(command.args), {
      onNone: () => [],
      onSome: ({ change }) =>
        LobbyChange.isAnyOf(['ChangedPicks'])(change)
          ? [change.mode, change.difficulty]
          : [],
    }),
  )
