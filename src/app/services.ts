import { Layer } from 'effect'

import { layer as CoopNetLayer } from '../features/coop/net'
import { layer as InstallPromptLayer } from '../platform/install'
import { layer as PlayerStoreLayer } from '../platform/store'

// NOTE: the services the handlers use: the player store (save and sync),
// co-op's network over it, and the browser's install prompt.
export const ApplicationLayer = Layer.merge(
  Layer.provideMerge(CoopNetLayer, PlayerStoreLayer),
  InstallPromptLayer,
)
