import '../../src/art/atlas/spriteAtlasBoot'
import { Effect, Layer } from 'effect'

import { Head } from '@effect/ui'
import { BrowserHost } from '@effect/ui/html'

import { StudioDef } from './block'
import { flags, subscriptions } from './commands'
import { defineStudioPicture } from './picture'
import { defineStudioStage } from './stage3d'
import { init, update } from './update'
import { titleOf, view } from './view'
import { defineStudioWorld } from './worldStage'

const Studio = StudioDef.make({
  init,
  update,
  view,
  subscriptions,
  head: ({ model }) => [Head.title(titleOf(model))],
})

defineStudioPicture()
defineStudioWorld()
defineStudioStage()

const root = document.getElementById('root')

if (root !== null) {
  flags.pipe(
    Effect.flatMap(startFlags =>
      Layer.launch(BrowserHost.mount(Studio, { flags: startFlags }, root)),
    ),
    Effect.runFork,
  )
}
