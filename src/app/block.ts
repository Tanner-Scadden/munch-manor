import { Layer } from 'effect'

import { Component, Head } from '@effect/ui'

import { GAME_TITLE } from '../shared/constants'
import { ApplicationDef } from './definition'
import { CommandsLayer } from './layer'
import { init, update } from './main'
import { ApplicationLayer } from './services'
import { subscriptions } from './subscriptions'
import { view } from './view'

// NOTE: the root component as defined, requiring its Command services. The
// tests and the audit harness provide their own Layers to it.
// NOTE: a component is a function Effect UI makes, with no data-last form
// to give it.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const ApplicationNoDeps = ApplicationDef.make({
  init,
  update,
  subscriptions,
  view,
  head: () => [Head.title(GAME_TITLE)],
})

// NOTE: the root the page mounts, with every Command's service and the
// services they capture (the store, co-op's network, the install prompt).
// @effect-diagnostics-next-line missingPipeableSignature:off
export const Application = ApplicationNoDeps.pipe(
  Component.provide(Layer.provideMerge(CommandsLayer, ApplicationLayer)),
)
