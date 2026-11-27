import { Layer } from 'effect'

import { Component, Head } from '@effect/ui'

import { GAME_TITLE } from '#shared/constants.ts'

import { CommandsLayer } from './commands.ts'
import { ApplicationDef } from './component.ts'
import { init, update } from './main.ts'
import { ApplicationLayer } from './services.ts'
import { subscriptions } from './subscriptions.ts'
import { view } from './view.ts'

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
