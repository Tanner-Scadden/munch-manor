import { Layer } from 'effect'

import { Dialog } from '@foldkit/ui'

import { CoopLayer } from '../features/coop'
import { LobbyLayer } from '../features/lobby/layer'
import { MunchopediaLayer } from '../features/munchopedia/layer'
import { ProfileLayer } from '../features/profile/layer'
import { ProofShelfLayer } from '../features/proof/layer'
import { ApplicationBlock } from './definition'
import { EffectsLayer } from './layer'
import { init, update } from './main'
import { subscriptions } from './subscriptions'
import { managedResources } from './update/sound'
import { view } from './view'

// NOTE: every child's implementation Layer: the dialogs, the
// Munchopedia, the Proof Shelf, the Profile, the lobby, and co-op. The audit
// harness (tools/audit/harness/entry.ts) completes the root with them too.
export const ChildLayers = Layer.mergeAll(
  Dialog.layer,
  MunchopediaLayer,
  ProofShelfLayer,
  ProfileLayer,
  LobbyLayer,
  CoopLayer,
)

// NOTE: the root's implementation Layer, with every child's. The Program
// and the tests take it with the Block, `{ block: ApplicationBlock, layer }`.
export const layer = ApplicationBlock.makeLayer({
  init,
  update,
  view,
  subscriptions,
  managedResources,
  EffectsLayer,
}).pipe(Layer.provide(ChildLayers))
