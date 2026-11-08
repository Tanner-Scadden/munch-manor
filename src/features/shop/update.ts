import { ShopComposition } from './composition'
import { OutMessage } from './message'
import { openGuide } from './steps'

// NOTE: the shop's own Messages. A row picked, focused, or an arrow key's
// next row goes up for the root to make in the World; the root answers an
// arrow key with `requestFocusItem` while the player browses.
export const update = ShopComposition.makeUpdate({
  ClickedBuyButton: (model, { item }) => ({
    model,
    outMessage: OutMessage.PickedItem({ item }),
  }),
  PressedBuyKey: (model, { item }) => ({
    model,
    outMessage: OutMessage.PickedItem({ item }),
  }),
  MovedFocus: (model, { item }) => ({
    model,
    outMessage: OutMessage.MovedFocus({ item }),
  }),
  FocusedItem: (model, { item }) => ({
    model,
    outMessage: OutMessage.FocusedItem({ item }),
  }),
  CompletedFocusItem: model => ({ model }),
  ClickedGuideButton: (model, { section }) => openGuide(section)(model),
})
