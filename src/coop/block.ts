import { Layer } from 'effect'

import { CoopComposition } from './composition'
import { CoopBlock } from './definition'
import { initialModel } from './model'
import { subscriptions } from './subscriptions'
import { CommandsLayer, update } from './update'
import { view } from './view'

const init = CoopComposition.makeInit(() => ({ model: initialModel }))

const EffectsLayer = Layer.merge(CommandsLayer, subscriptions.layer)

// NOTE: co-op's implementation Layer. The root's Layer (src/block.ts)
// provides it.
export const CoopLayer = CoopBlock.makeLayer({
  init,
  update,
  view,
  subscriptions,
  EffectsLayer,
})
