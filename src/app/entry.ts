// NOTE: first, so the prebuilt sprite atlas is in place before any module
// builds a sprite (see src/art/spriteAtlasBoot.ts).
import '../art/spriteAtlasBoot'
import { Effect } from 'effect'
import { Program, Runtime } from 'foldkit'

import { preventPageZoom } from '../input/noZoom'
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

Runtime.run(program)
