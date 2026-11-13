import { ProofShelfBlock } from './block'
import { ProofShelfComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { initialModel } from './model'
import { FocusShelfSlot } from './steps'
import { update } from './update'
import { proofShelfImplementation } from './view'

const init = ProofShelfComposition.makeInit(() => ({ model: initialModel }))

// NOTE: the Proof Shelf's implementation Layer. The root's Layer
// (src/app/block.ts) provides it.
export const ProofShelfLayer = ProofShelfBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: proofShelfImplementation.view,
  EffectsLayer: FocusShelfSlot.layer,
})
