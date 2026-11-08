import { MunchopediaComposition } from './composition'
import { openEntry, openShop, showList } from './steps'

// NOTE: the Munchopedia's own Messages: a zombie's tile opens its entry,
// BACK returns to the tiles, and the Shop tile opens the guide on Guns.
export const update = MunchopediaComposition.makeUpdate({
  ClickedEntryButton: (model, { kind }) => openEntry(kind)(model),
  ClickedListButton: model => ({ model: showList(model) }),
  ClickedShopButton: openShop,
})
