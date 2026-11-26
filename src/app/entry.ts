// NOTE: first, so the prebuilt sprite atlas is in place before any module
// builds a sprite (see src/art/spriteAtlasBoot.ts).
import '../art/spriteAtlasBoot'
import { Effect, Layer } from 'effect'

import { BrowserHost } from '@effect/ui/html'

import { preventPageZoom } from '../input/noZoom'
import { defineWorldElement } from '../render/iso/element'
import { defineOverlayElement } from '../render/iso/overlayElement'
import { definePlinthElement } from '../render/iso/plinthElement'
import { canDrawWorld, unsupportedNode } from '../render/iso/support'
import { Application } from './block'

// NOTE: every module has run by here, sprites built at module load included.
performance.mark('load:modules')

Effect.runSync(preventPageZoom)

// NOTE: a device with no WebGL2 can't draw the house: the splash says so
// in place of its load bar, and the game never starts.
const showUnsupported = (): void => {
  const splash = document.getElementById('splash')
  splash?.querySelector('.splash-line')?.remove()
  splash?.querySelector('.splash-bar')?.remove()
  splash?.setAttribute('aria-busy', 'false')
  splash?.append(unsupportedNode())
}

const root = document.getElementById('root')

// NOTE: the root mounts in #root once the page has a WebGL2 context to draw
// the house with.
if (canDrawWorld() && root !== null) {
  defineWorldElement()
  defineOverlayElement()
  definePlinthElement()
  Layer.launch(BrowserHost.mount(Application, {}, root)).pipe(Effect.runFork)
} else {
  showUnsupported()
}
