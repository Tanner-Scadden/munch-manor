import { Layer } from 'effect'

import { GuideLayer } from '../guide/layer'
import { MunchopediaBlock } from './block'
import { MunchopediaComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { initialModel } from './model'
import { update } from './update'
import { munchopediaImplementation } from './view'

const init = MunchopediaComposition.makeInit(() => ({ model: initialModel }))

// NOTE: the Munchopedia's implementation Layer, with its shop guide's. The
// root's Layer (src/app/block.ts) provides it.
export const MunchopediaLayer = MunchopediaBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: munchopediaImplementation.view,
}).pipe(Layer.provide(GuideLayer))
