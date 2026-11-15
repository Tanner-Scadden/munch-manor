// NOTE: first, so the prebuilt sprite atlas is in place before any module
// builds a sprite (see src/art/spriteAtlasBoot.ts).
import '../art/spriteAtlasBoot'
import { Effect } from 'effect'
import { Program, Runtime } from 'foldkit'

import { preventPageZoom } from '../input/noZoom'
import { defineWorldElement } from '../render/iso/element'
import { definePlinthElement } from '../render/iso/plinthElement'
import { canDrawWorld, unsupportedNode } from '../render/iso/support'
import { layer } from './block'
import { ApplicationBlock } from './definition'
import { ApplicationLayer } from './services'

// NOTE: every module has run by here, sprites built at module load included.
performance.mark('load:modules')

Effect.runSync(preventPageZoom)

const program = Program.make({
  block: ApplicationBlock,
  layer,
  container: document.getElementById('root'),
  devTools: {
    excludeFromHistory: [
      'TickedFrame',
      'TickedRoomFrame',
      'GotCoopMessage',
      'MovedPointer',
      'MovedMouse',
      'CompletedPlaySound',
    ],
  },
}).provide(ApplicationLayer)

// NOTE: a device with no WebGL2 can't draw the house: the splash says so
// in place of its load bar, and the game never starts.
const showUnsupported = (): void => {
  const splash = document.getElementById('splash')
  splash?.querySelector('.splash-line')?.remove()
  splash?.querySelector('.splash-bar')?.remove()
  splash?.setAttribute('aria-busy', 'false')
  splash?.append(unsupportedNode())
}

if (canDrawWorld()) {
  defineWorldElement()
  definePlinthElement()
  Runtime.run(program)
} else {
  showUnsupported()
}
