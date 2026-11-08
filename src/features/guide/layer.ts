import { GuideBlock } from './block'
import { GuideComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { initialModel } from './model'
import { FocusGuideControl } from './steps'
import { update } from './update'
import { guideImplementation } from './view'

const init = GuideComposition.makeInit(placement => ({
  model: initialModel(placement),
}))

// NOTE: the guide's implementation Layer. The root's Layer
// (src/app/block.ts) and the Munchopedia's
// (src/features/munchopedia/layer.ts) provide it.
export const GuideLayer = GuideBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: guideImplementation.view,
  EffectsLayer: FocusGuideControl.layer,
})
