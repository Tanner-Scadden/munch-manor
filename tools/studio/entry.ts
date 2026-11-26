// The art studio's page (see ./README.md). Served by `bun dev` at
// /tools/studio/, never built into the game.
// NOTE: first, as in src/app/entry.ts, so the atlas is in place before any
// sprite is built.
import '../../src/art/spriteAtlasBoot'
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

// NOTE: the studio as made: its init, update, view, Subscriptions, and the
// page's title. Its Commands need no service.
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
