import { Layer } from 'effect'

import { CoopBlock } from './block'
import { CoopComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { initialModel } from './model'
import { subscriptions } from './subscriptions'
import { CommandsLayer, update } from './update'
import { view } from './view'

const init = CoopComposition.makeInit(() => ({ model: initialModel }))

const EffectsLayer = Layer.merge(CommandsLayer, subscriptions.layer)

// NOTE: co-op's implementation Layer. The root's Layer (src/app/block.ts)
// provides it.
export const CoopLayer = CoopBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view,
  subscriptions,
  EffectsLayer,
})
