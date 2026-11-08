import { Tabs } from '@foldkit/ui'

import type { ShopCategory } from '../../world/schema/worldSchema'

// NOTE: the shop dialog's tabs, the client's own: the step never imports
// the UI.
export const ShopTabsBlock = Tabs.makeBlock<ShopCategory>()
