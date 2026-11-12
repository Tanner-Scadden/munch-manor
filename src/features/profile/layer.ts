import { Layer } from 'effect'

import { Tabs } from '@foldkit/ui'

import { ProfileBlock } from './block'
import { CharacterLayer } from './blocks/look/layer'
import { ProfileComposition } from './composition'
import { FocusLookOption, inMessageUpdate } from './inMessageUpdate'
import { CopyLinkCodeOnClick, PasteLinkCodeOnTap } from './linkClipboard'
import { initialModel } from './model'
import {
  FocusTutorialReset,
  RedeemLinkCode,
  RequestLinkCode,
  update,
} from './update'
import { profileImplementation } from './view'

const init = ProfileComposition.makeInit(() => ({ model: initialModel }))

const EffectsLayer = Layer.mergeAll(
  RequestLinkCode.layer,
  RedeemLinkCode.layer,
  FocusTutorialReset.layer,
  FocusLookOption.layer,
  CopyLinkCodeOnClick.layer,
  PasteLinkCodeOnTap.layer,
)

// NOTE: the Profile's implementation Layer, with its tab strip's and the
// Look tab's. The root's Layer (src/app/block.ts) provides it.
export const ProfileLayer = ProfileBlock.makeLayer({
  init,
  update,
  inMessageUpdate,
  view: profileImplementation.view,
  EffectsLayer,
}).pipe(Layer.provide(Layer.mergeAll(Tabs.layer, CharacterLayer)))
