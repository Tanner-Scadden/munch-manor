import { RadioGroup } from '@foldkit/ui'

import type { LookSection } from './clientSchema'

// NOTE: the Look tab's radio groups. They live apart from src/character.ts
// so the Model can hold their state without importing the picker.
export const SectionRadioGroupBlock = RadioGroup.makeBlock<LookSection>()

// NOTE: one radio group serves every part: its values are the part's own
// words, and chooseLook reads them back through the part's Schema.
export const PartRadioGroupBlock = RadioGroup.makeBlock()
