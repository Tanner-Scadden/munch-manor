import { Array, Option, Schema } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  type LobbyChange,
  type Room,
  Screen,
  maybeRoomOf,
} from '../../../domain/coopRoom'
import { home } from '../../../test/model.fixture'
import type { RootStep } from '../../../test/testing'
import { type Model as CoopModel } from '../model'
import { freshRoom } from '../roomState'
import { ChangeLobby } from '../steps'
import { CODE, type lobbyOf } from '../testing'
import { type CoopCommand, type CoopResult, open, updateCoop } from '../update'

const startModel: CoopModel = initialModel.coop

const onHubCoop: CoopModel = open({
  name: '',
  maybeCode: Option.none(),
  look: '',
  rank: 1,
  calling: 'You',
  bought: ['hero:Handyman'],
  bones: 0,
  rngState: startModel.rngState,
  introSeen: false,
})(startModel).model

export const withCoop = (coop: CoopModel): Model =>
  UiStruct.evolve(home, {
    coop: () => coop,
    boughtCosmetics: () => ['hero:Handyman'],
  })

export const onHub: Model = withCoop(onHubCoop)

export const roomOf = (current: Model): Room =>
  Option.getOrThrow(maybeRoomOf(current.coop))

export const inRoomCoop = (slot: number): CoopModel =>
  UiStruct.evolve(onHubCoop, {
    screen: () => Screen.InRoom({ room: freshRoom(CODE, slot) }),
  })

export const inRoom = (slot: number): Model => withCoop(inRoomCoop(slot))

export const lobbyUpdate = (lobby: ReturnType<typeof lobbyOf>) =>
  Message.ReceivedLobbyEvent({ event: { _tag: 'Updated', lobby } })

export const coopAt = (screen: Screen): Model =>
  withCoop(
    UiStruct.evolve(startModel, {
      screen: () => screen,
      bought: () => ['hero:Handyman'],
    }),
  )

export type Driven = Readonly<{
  coop: CoopModel
  commands: ReadonlyArray<CoopCommand>
}>

export const drivenFrom = (coop: CoopModel): Driven => ({ coop, commands: [] })

export const byRule =
  (rule: (coop: CoopModel) => CoopResult) =>
  (driven: Driven): Driven => {
    const result = rule(driven.coop)
    return {
      coop: result.model,
      commands: [...driven.commands, ...(result.commands ?? [])],
    }
  }

export const byMessage = (
  message: Parameters<typeof updateCoop>[0],
): ((driven: Driven) => Driven) => byRule(updateCoop(message))

export const argsIssued =
  <D extends Command.Definition.Any & Readonly<{ args: Schema.Top }>>(
    definition: D,
  ) =>
  (driven: Driven): ReadonlyArray<Command.Definition.Args<D>> =>
    Array.filter(
      Array.flatMap(driven.commands, command =>
        'args' in command && command.name === Command.nameOf(definition)
          ? [command.args]
          : [],
      ),
      (args): args is Command.Definition.Args<D> =>
        Schema.is(definition.args)(args),
    )

export const lobbyChanged =
  (change: LobbyChange): RootStep =>
  s =>
    s.resolve(ChangeLobby.make({ change }), Component.noop)
