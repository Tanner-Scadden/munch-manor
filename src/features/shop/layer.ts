import { Layer } from 'effect'

import { Dialog, Tabs } from '@foldkit/ui'

import { GuideLayer } from '../guide/layer'
import { ShopBlock } from './block'
import { ShopComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { FocusItem } from './steps'
import { update } from './update'
import { shopImplementation } from './view'

const init = ShopComposition.makeInit(() => ({ model: {} }))

// NOTE: the shop dialog's implementation Layer, with its Dialog's, its
// tabs', and its guide's. The root's Layer (src/app/block.ts) provides it.
export const ShopLayer = ShopBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: shopImplementation.view,
  EffectsLayer: FocusItem.layer,
}).pipe(Layer.provide(Layer.mergeAll(Dialog.layer, Tabs.layer, GuideLayer)))
