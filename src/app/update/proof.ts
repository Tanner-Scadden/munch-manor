import { openedThingsOf } from '../../domain/journal'
import { shelfThingsFor } from '../../features/proof/proof'
import { ProofShelfBinding } from '../bindings'
import { makeStep } from '../definition'
import { isPanelOpen } from '../menuState'
import { unchanged } from './step'

// The root's side of the Proof Shelf (src/features/proof/): a key goes to
// the shelf while it is up, where the arrows walk its slots. Opening it is
// a card in the MORE hand (`openProof` in src/app/update/home.ts).

export const proofFromKey = (code: string) =>
  makeStep(model =>
    isPanelOpen(model, 'Proof')
      ? ProofShelfBinding.requestPressKey({
          code,
          things: shelfThingsFor(openedThingsOf(model)),
        })
      : unchanged,
  )
