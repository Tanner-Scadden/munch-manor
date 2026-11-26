import { Layer } from 'effect'

import { Component, Head } from '@effect/ui'

import { GAME_TITLE } from '../shared/constants'
import { ApplicationDef } from './definition'
import { CommandsLayer } from './layer'
import { init, update } from './main'
import { ApplicationLayer } from './services'
import { subscriptions } from './subscriptions'
import { view } from './view'

export const ApplicationNoDeps = ApplicationDef.make({
  init,
  update,
  subscriptions,
  view,
  head: () => [Head.title(GAME_TITLE)],
})

export const Application = ApplicationNoDeps.pipe(
  Component.provide(Layer.provideMerge(CommandsLayer, ApplicationLayer)),
)
