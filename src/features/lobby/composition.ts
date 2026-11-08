import type { Block } from 'foldkit'

import { DialogBlock } from '@foldkit/ui'

import { HeroPickerBlock } from '../heroes/block'
import { HeroDialogBinding, HeroPickerBinding } from './bindings'
import {
  LobbyBlock,
  makeComposition,
  makeNoopStep,
  makeOutMessageStep,
} from './block'
import { OutMessage } from './message'
import { buyHero, closeHeroPicker } from './steps'

// NOTE: the lobby's children and their folds. A hero card goes up to the
// root, which owns the rules, saying which bot it is for, if any; BUY goes up
// for the player's own hero. The picker's close button closes the Dialog,
// and the Dialog closing (Escape, the backdrop, a hero worn) closes the
// picker.

const HeroPickerBindingWithOutMessagePolicy =
  HeroPickerBinding.withOutMessagePolicy({
    fold: LobbyBlock.makeOutMessageFold(HeroPickerBlock, {
      PickedCard: ({ calling }) =>
        makeOutMessageStep(model =>
          OutMessage.PickedHero({ calling, maybeBot: model.maybePickingBot }),
        ),
      ClickedBuy: ({ calling }) => buyHero(calling),
      Closed: () => HeroDialogBinding.requestClose(),
    }),
  })

const HeroDialogBindingWithOutMessagePolicy =
  HeroDialogBinding.withOutMessagePolicy({
    fold: LobbyBlock.makeOutMessageFold(DialogBlock, {
      Opened: makeNoopStep,
      Closed: () => closeHeroPicker,
      CompletedClose: makeNoopStep,
    }),
  })

export const LobbyComposition = makeComposition({
  bindings: [
    HeroPickerBindingWithOutMessagePolicy,
    HeroDialogBindingWithOutMessagePolicy,
  ],
})
export type LobbyViewBuilder = Block.ViewBuilderFor<typeof LobbyComposition>
