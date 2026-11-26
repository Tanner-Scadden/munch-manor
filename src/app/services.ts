import { Layer } from 'effect'

import { audioEngineLayer } from '../audio/audio'
import { layer as CoopNetLayer } from '../features/coop/net'
import { layer as InstallPromptLayer } from '../platform/install'
import { layer as PlayerStoreLayer } from '../platform/store'

export const ApplicationLayer = Layer.mergeAll(
  Layer.provideMerge(CoopNetLayer, PlayerStoreLayer),
  InstallPromptLayer,
  audioEngineLayer,
)
