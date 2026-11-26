import '#art/atlas/spriteAtlasBoot.ts'
import { Effect, Layer } from 'effect'

import { BrowserHost } from '@effect/ui/html'

import { preventPageZoom } from '#input/noZoom.ts'
import { defineWorldElement } from '#render/iso/element.ts'
import { defineOverlayElement } from '#render/iso/overlayElement.ts'
import { definePlinthElement } from '#render/iso/plinth/plinthElement.ts'
import { canDrawWorld, unsupportedNode } from '#render/iso/support.ts'

import { Application } from './block.ts'

performance.mark('load:modules')

Effect.runSync(preventPageZoom)

const showUnsupported = (): void => {
  const splash = document.getElementById('splash')
  splash?.querySelector('.splash-line')?.remove()
  splash?.querySelector('.splash-bar')?.remove()
  splash?.setAttribute('aria-busy', 'false')
  splash?.append(unsupportedNode())
}

const root = document.getElementById('root')

if (canDrawWorld() && root !== null) {
  defineWorldElement()
  defineOverlayElement()
  definePlinthElement()
  Layer.launch(BrowserHost.mount(Application, {}, root)).pipe(Effect.runFork)
} else {
  showUnsupported()
}
