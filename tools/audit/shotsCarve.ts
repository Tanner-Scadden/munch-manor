// The carved showpieces (src/art/carve.ts, src/render/iso/showpieces.ts):
// the dining room's chandelier hung and fallen, carved and as its old
// sprite (`billboards`), as `carve-<TAG>-<viewport>-<scene>-<carved|sprite>.png`.
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

const DINING =
  'god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen&px=180&py=150&freeze=20'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'hung', query: DINING },
  { name: 'fallen', query: `${DINING}&fallen` },
]

const LOOKS = ['carved', 'sprite'] as const

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
        for (const look of LOOKS) {
          const page = yield* openPage(browser, viewport)
          const query =
            look === 'sprite' ? `${scene.query}&billboards` : scene.query
          yield* gotoScene(page, harnessUrl(query, deviceQuery(viewport)))
          yield* shot(
            page,
            `carve-${tag}-${viewport.name}-${scene.name}-${look}`,
          )
          yield* closePage(page)
        }
      }
    }
  }),
)
