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

// What the co-op Story and Scene tests start from. Co-op is the root's own
// state (its `coop` field), so a test drives the root with co-op open in
// it: a player on the hub with one hero bought, and a room around them.

// NOTE: co-op's start Model, as the root's init leaves it.
const startModel: CoopModel = initialModel.coop

// NOTE: co-op opened on the hub with no name, look, or rank of its own, so
// the room requests it makes are plain to read.
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

// NOTE: the root on the home menu with `coop` as co-op's state, the
// Handyman bought, as co-op's own Model says.
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

// NOTE: the root with co-op on the screen a Scene looks at, one hero
// bought.
export const coopAt = (screen: Screen): Model =>
  withCoop(
    UiStruct.evolve(startModel, {
      screen: () => screen,
      bought: () => ['hero:Handyman'],
    }),
  )

// CO-OP'S RULES ALONE

// NOTE: co-op driven by its rules alone, with every Command they issued, for
// the root's requests that only a run in the root makes (a frame with this
// client's controls, a press, a frame held for hit-stop): co-op's Model and
// the Commands so far.
export type Driven = Readonly<{
  coop: CoopModel
  commands: ReadonlyArray<CoopCommand>
}>

export const drivenFrom = (coop: CoopModel): Driven => ({ coop, commands: [] })

// NOTE: one rule run on co-op as it stands, its Commands added.
export const byRule =
  (rule: (coop: CoopModel) => CoopResult) =>
  (driven: Driven): Driven => {
    const result = rule(driven.coop)
    return {
      coop: result.model,
      commands: [...driven.commands, ...(result.commands ?? [])],
    }
  }

// NOTE: one of co-op's Messages, by the rule the root runs for it.
export const byMessage = (
  message: Parameters<typeof updateCoop>[0],
): ((driven: Driven) => Driven) => byRule(updateCoop(message))

// NOTE: the args of every Command `definition` issued, typed by its args.
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

// NOTE: co-op's `change` sent to the room's lobby, reporting nothing.
export const lobbyChanged =
  (change: LobbyChange): RootStep =>
  s =>
    s.resolve(ChangeLobby.make({ change }), Component.noop)
