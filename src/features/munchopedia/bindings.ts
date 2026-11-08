import { GuideBlock } from '../guide/block'
import { placedIn } from '../guide/model'
import { makeRequiredFieldBinding } from './block'

// NOTE: the Munchopedia's child, the shop guide on its Shop page, apart
// from composition.ts so the Steps that call it import no cycle.
export const GuideBinding = makeRequiredFieldBinding(GuideBlock, {
  field: 'guide',
  init: { contextToArgs: () => placedIn('Munchopedia') },
})
