import { Layer } from 'effect'
import { Block } from 'foldkit'

import { CoopComposition } from './composition'
import { Message } from './message'
import { type Model, initialModel } from './model'
import { subscriptions } from './subscriptions'
import { CommandsLayer, update } from './update'
import { view } from './view'

const init = CoopComposition.makeInit(() => ({ model: initialModel }))

const EffectsLayer = Layer.merge(CommandsLayer, subscriptions.layer)

const prepare = () =>
  CoopComposition.prepareBlock({
    init,
    update,
    view,
    subscriptions,
    EffectsLayer,
    operations: {
      requestOpen: Message.RequestedOpen,
      requestPressKey: Message.RequestedPressKey,
      requestReleaseKey: Message.RequestedReleaseKey,
      requestTickRoom: Message.RequestedTickRoom,
      requestPressAction: Message.RequestedPressAction,
      requestKeepTracers: Message.RequestedKeepTracers,
    },
  })
export const CoopBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof Model,
  typeof prepare
> = Block.assemble(prepare)
