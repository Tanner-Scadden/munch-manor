import { Layer } from 'effect'

import { Dialog, Tabs } from '@foldkit/ui'

import { CoopLayer } from '../features/coop'
import { LobbyLayer } from '../features/lobby/layer'
import { ProfileLayer } from '../features/profile/layer'
import { ApplicationBlock } from './definition'
import { EffectsLayer } from './layer'
import { init, update } from './main'
import { subscriptions } from './subscriptions'
import { managedResources } from './update/sound'
import { view } from './view'

// NOTE: the root's implementation Layer, with every child's: the dialogs,
// the shop's tabs, the Profile, the lobby, and co-op. The Program and the tests take
// it with the Block, `{ block: ApplicationBlock, layer }`.
export const layer = ApplicationBlock.makeLayer({
  init,
  update,
  view,
  subscriptions,
  managedResources,
  EffectsLayer,
}).pipe(
  Layer.provide(
    Layer.mergeAll(
      Dialog.layer,
      Tabs.layer,
      ProfileLayer,
      LobbyLayer,
      CoopLayer,
    ),
  ),
)
