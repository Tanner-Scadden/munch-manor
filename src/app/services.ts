import { Layer } from 'effect'

import { audioEngineLayer } from '../audio/audio'
import { layer as CoopNetLayer } from '../features/coop/net'
import { layer as InstallPromptLayer } from '../platform/install'
import { layer as PlayerStoreLayer } from '../platform/store'

// NOTE: the services the handlers use: the player store (save and sync),
// co-op's network over it, the browser's install prompt, and the audio
// engine.
export const ApplicationLayer = Layer.mergeAll(
  Layer.provideMerge(CoopNetLayer, PlayerStoreLayer),
  InstallPromptLayer,
  audioEngineLayer,
)
