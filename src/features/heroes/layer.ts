import { HeroPickerBlock } from './block'
import { HeroPickerComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { initialModel } from './model'
import { update } from './update'
import { heroPickerImplementation } from './view'

const init = HeroPickerComposition.makeInit(() => ({ model: initialModel }))

// NOTE: the hero picker's implementation Layer. The solo lobby's Layer
// (src/features/lobby/layer.ts) and co-op's (src/features/coop/layer.ts)
// provide it.
export const HeroPickerLayer = HeroPickerBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: heroPickerImplementation.view,
})
