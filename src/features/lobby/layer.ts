import { Layer } from 'effect'

import { Dialog } from '@foldkit/ui'

import { HeroPickerLayer } from '../heroes/layer'
import { LobbyBlock } from './block'
import { LobbyComposition } from './composition'
import { inMessageUpdate } from './inMessageUpdate'
import { initialModel } from './model'
import { FocusLobbyControl, FoldLobby } from './steps'
import { update } from './update'
import { lobbyImplementation } from './view'

const init = LobbyComposition.makeInit(() => ({ model: initialModel }))

// NOTE: the lobby's implementation Layer, with its hero picker's and its
// Dialog's. The root's Layer (src/app/block.ts) provides it.
export const LobbyLayer = LobbyBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: lobbyImplementation.view,
  EffectsLayer: Layer.mergeAll(FocusLobbyControl.layer, FoldLobby.layer),
}).pipe(Layer.provide(Layer.mergeAll(Dialog.layer, HeroPickerLayer)))
