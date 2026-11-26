import { Layer } from 'effect'

import { audioEngineLayer } from '#audio/audio.ts'
import { layer as CoopNetLayer } from '#features/coop/net.ts'
import { layer as InstallPromptLayer } from '#platform/install.ts'
import { layer as PlayerStoreLayer } from '#platform/store.ts'

export const ApplicationLayer = Layer.mergeAll(
  Layer.provideMerge(CoopNetLayer, PlayerStoreLayer),
  InstallPromptLayer,
  audioEngineLayer,
)
