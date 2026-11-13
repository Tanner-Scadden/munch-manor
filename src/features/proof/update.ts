import { ProofShelfComposition } from './composition'
import { pick } from './steps'

// NOTE: the shelf's own Messages: a tapped slot shows its stamp.
export const update = ProofShelfComposition.makeUpdate({
  ClickedSlot: (model, { spot }) => ({ model: pick(spot)(model) }),
  CompletedFocusSlot: model => ({ model }),
})
