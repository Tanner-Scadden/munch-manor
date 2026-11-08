import { Option } from 'effect'

import { HeroPickerComposition } from './composition'
import { OutMessage } from './message'
import { isPickerOpen } from './model'
import { closed } from './steps'

// NOTE: a tap on a card or BUY only asks: the parent owns the rules (rank,
// ownership, the Bones) and answers with `InformedOfOutcome`. The close
// button closes the picker here and says so.
export const update = HeroPickerComposition.makeUpdate({
  ClickedCard: (model, { calling }) =>
    isPickerOpen(model)
      ? { model, outMessage: OutMessage.PickedCard({ calling }) }
      : { model },

  ClickedBuyButton: model =>
    Option.match(model.maybeTrying, {
      onNone: () => ({ model }),
      onSome: calling =>
        isPickerOpen(model)
          ? { model, outMessage: OutMessage.ClickedBuy({ calling }) }
          : { model },
    }),

  ClickedCloseButton: model =>
    isPickerOpen(model)
      ? { model: closed(model), outMessage: OutMessage.Closed() }
      : { model },
})
