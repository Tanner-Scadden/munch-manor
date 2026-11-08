import { HeroPickerBlock } from '../heroes/block'
import { makeRequiredFieldBinding } from './block'

// NOTE: co-op's child: the hero picker its lobby's pill opens. Its fold is
// chosen in composition.ts, so the Steps that call it (steps.ts) and the
// fold that calls those Steps import no cycle.
export const HeroPickerBinding = makeRequiredFieldBinding(HeroPickerBlock, {
  field: 'heroPicker',
})
