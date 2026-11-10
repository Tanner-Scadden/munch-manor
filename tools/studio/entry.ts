// The art studio's page (see ./README.md). Served by `bun dev` at
// /tools/studio/, never built into the game.
// NOTE: first, as in src/app/entry.ts, so the atlas is in place before any
// sprite is built.
import '../../src/art/spriteAtlasBoot'
import { Program, Runtime } from 'foldkit'

import { Flags, StudioBlock } from './block'
import { EffectsLayer, flags, subscriptions } from './commands'
import { init, update } from './update'
import { view } from './view'

const layer = StudioBlock.makeLayer({
  init,
  update,
  view,
  subscriptions,
  EffectsLayer,
})

const program = Program.make({
  block: StudioBlock,
  layer,
  Flags,
  container: document.getElementById('root'),
  devTools: {
    excludeFromHistory: ['TickedFrame', 'ReceivedNotes', 'LostInbox'],
  },
})

Runtime.run(program, { flags })
