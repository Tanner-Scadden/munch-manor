import { DialogBinding } from './bindings'
import { ShopComposition } from './composition'
import { focusItem, open, pressKey } from './steps'

// NOTE: the root's requests. Closing is the Dialog's own close, so its
// Closed goes up to the root as a user's close does.
export const inMessageUpdate = ShopComposition.makeInMessageUpdate({
  RequestedOpen: open,
  RequestedClose: DialogBinding.requestClose(),
  RequestedPressKey: (model, keyPress) => pressKey(keyPress)(model),
  RequestedFocusItem: (model, { item }) => focusItem(item)(model),
})
