// The carve pass (src/art/carve.ts, src/render/iso/voxels.ts,
// showpieces.ts): every standing thing carved into blocks, in the rooms
// where it stands: the dining room's chandelier hung and fallen, its table
// and hutches, the display cases, the library's stacks, the cellar's racks,
// the kitchen's pantry and crates in a break, the stove and the fridge
// carved as boxes, the parlour's gramophone and hearth with its fire, the
// front door, Uncle Chunk's hand set depth, and a crowd of bodies, as
// `carve-<TAG>-<viewport>-<scene>.png`. Set beside an earlier TAG for a
// before and after, and zoom in on the bodies to look for rims and holes.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsCarve.ts
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  closePage,
  deviceQuery,
  gotoScene,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  shot,
  shotViewports,
} from './lib'

const HOUSE =
  'god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen'
const DINING = `${HOUSE}&px=180&py=150&freeze=20`
const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,displayCase'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'hung', query: DINING },
  { name: 'fallen', query: `${DINING}&fallen` },
  {
    name: 'crowd',
    query: `${HOUSE}&px=180&py=150&start=wave&elapsed=6000&crowd=12&freeze=20`,
  },
  {
    name: 'lineup',
    query: 'wave=3&seen=all&start=wave&elapsed=6000&god&lineup=sizes&freeze=20',
  },
  {
    name: 'cases',
    query: `${LEARNED}&wave=3&break=open&kills=Runner:3&px=44&py=150&freeze=20`,
  },
  {
    name: 'library',
    query: `${HOUSE}&px=520&py=90&break=open&freeze=20`,
  },
  {
    name: 'cellar',
    query: `${HOUSE}&px=840&py=110&break=open&tool=Bulb&firedms=200&freeze=20`,
  },
  {
    name: 'kitchen',
    query: `${HOUSE}&px=160&py=-75&break=open&freeze=20`,
  },
  {
    name: 'stove',
    query: `${HOUSE}&px=120&py=-90&break=open&tool=SoupPot&firedms=200&freeze=20`,
  },
  {
    name: 'parlour',
    query: `${HOUSE}&px=-190&py=110&break=open&freeze=20`,
  },
  {
    name: 'door',
    query: `${HOUSE}&px=180&py=190&break=open&freeze=20`,
  },
  {
    name: 'boss',
    query:
      'wave=8&seen=all&start=wave&elapsed=6000&god&boss=fighting&bx=200&by=80&freeze=20',
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* openPage(browser, viewport)
        yield* gotoScene(page, harnessUrl(scene.query, deviceQuery(viewport)))
        yield* shot(page, `carve-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
