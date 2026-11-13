import { ProofShelfComposition } from './composition'
import { openAfresh, pressKey } from './steps'

// NOTE: the root's requests: open with nothing picked, and a key.
export const inMessageUpdate = ProofShelfComposition.makeInMessageUpdate({
  RequestedOpen: () => ({ model: openAfresh() }),
  RequestedPressKey: (model, { code, things }) =>
    pressKey({ code, things })(model),
})
