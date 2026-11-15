// The doorways in the house's back walls in 3D (src/render/iso/house.ts):
// the dining room's yard door, the kitchen's, and the parlour's, each from
// the room below it, as `doors-<TAG>-<viewport>-<scene>.png`, so the
// opening's depth through the wall can be judged.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsDoors.ts
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

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'yard', query: 'wave=5&seen=all&god&px=280&py=60&freeze=20' },
  {
    name: 'kitchen',
    query: 'wave=5&seen=all&god&openexits=Kitchen&px=70&py=50&freeze=20',
  },
  {
    name: 'back-door',
    query: 'wave=5&seen=all&god&openexits=Kitchen&px=130&py=-110&freeze=20',
  },
  {
    name: 'walk-in',
    query:
      'wave=5&seen=all&start=wave&elapsed=6000&god&crowd=12&px=280&py=60&freeze=40',
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
        yield* shot(page, `doors-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
