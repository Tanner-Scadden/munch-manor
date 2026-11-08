import type { Block } from 'foldkit'

import { makeComposition } from './block'

export const HeroPickerComposition = makeComposition()
export type HeroPickerViewBuilder = Block.ViewBuilderFor<
  typeof HeroPickerComposition
>
