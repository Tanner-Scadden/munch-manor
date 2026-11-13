import { MunchopediaComposition } from './composition'
import { openEntry, openShop, showList, showStoryPage, showTab } from './steps'

// NOTE: the Dare Journal's own Messages: a zombie's tile opens its entry,
// BACK returns to the tiles, the Shop tile opens the guide on Guns, a tab
// shows its page, and a story page's number turns to it.
export const update = MunchopediaComposition.makeUpdate({
  ClickedEntryButton: (model, { kind }) => openEntry(kind)(model),
  ClickedListButton: model => ({ model: showList(model) }),
  ClickedShopButton: openShop,
  ClickedTabButton: (model, { tab }) => ({ model: showTab(tab)(model) }),
  ClickedStoryPageButton: (model, { page }) => ({
    model: showStoryPage(page)(model),
  }),
})
