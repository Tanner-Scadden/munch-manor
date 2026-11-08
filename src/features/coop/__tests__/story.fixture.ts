import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { initialModel } from '../../../app/pureApp'
import { type Room, Screen, maybeRoomOf } from '../../../domain/coopRoom'
import { CoopBlock } from '../block'
import { InMessage } from '../inMessage'
import { CoopLayer } from '../layer'
import { Message } from '../message'
import { type Model } from '../model'
import { freshRoom } from '../roomState'
import { CODE, type lobbyOf } from '../testing'
import { open } from '../update'

// What the co-op Story and Scene tests start from: co-op's Block on its own,
// a player on the hub with one hero bought, and a room around them.

// NOTE: co-op's Block as a Block-aware Story takes it:
// `Story.story(COOP, Story.given(onHub), ...)`. Its requests from the root go
// in with `Story.inMessage(InMessage.RequestedPressKey({ code }))`.
export const COOP = { block: CoopBlock, layer: CoopLayer }

// NOTE: a key the root hands co-op while it is open.
export const pressed = (code: string) =>
  Story.inMessage(InMessage.RequestedPressKey({ code }))

// NOTE: co-op's whole start Model, its hero picker's field included, as the
// root's CoopBinding starts it.
const startModel: Model = initialModel.coop

export const onHub: Model = open(startModel, '', Option.none(), '', 1, 'You', [
  'hero:Handyman',
]).model

export const roomOf = (current: Model): Room =>
  Option.getOrThrow(maybeRoomOf(current))

export const inRoom = (slot: number): Model =>
  modifyFields(onHub, {
    screen: () => Screen.InRoom({ room: freshRoom(CODE, slot) }),
  })

export const lobbyUpdate = (lobby: ReturnType<typeof lobbyOf>) =>
  Message.ReceivedLobbyEvent({ event: { _tag: 'Updated', lobby } })

// NOTE: co-op on the screen a Scene looks at, with one hero bought.
export const coopAt = (screen: Screen): Model =>
  modifyFields(startModel, {
    screen: () => screen,
    bought: () => ['hero:Handyman'],
  })
