import type { Block } from 'foldkit'

import { HeroPickerBlock } from '../heroes/block'
import { HeroPickerBinding } from './bindings'
import { CoopBlock, makeComposition, makeNoopStep } from './block'
import { buyHero, pickHero } from './steps'

// NOTE: co-op's child, the hero picker. A card and BUY are judged here, by
// the player's rank, the heroes bought, and the Bones co-op was handed;
// BUY's spend goes up to the parent. Closing needs nothing more.
const HeroPickerBindingWithOutMessagePolicy =
  HeroPickerBinding.withOutMessagePolicy({
    fold: CoopBlock.makeOutMessageFold(HeroPickerBlock, {
      PickedCard: ({ calling }) => pickHero(calling),
      ClickedBuy: ({ calling }) => buyHero(calling),
      Closed: makeNoopStep,
    }),
  })

export const CoopComposition = makeComposition({
  bindings: [HeroPickerBindingWithOutMessagePolicy],
})
export type CoopViewBuilder = Block.ViewBuilderFor<typeof CoopComposition>
