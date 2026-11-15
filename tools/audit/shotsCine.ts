// The camera's big moments (src/render/cine.ts): the boss at a door, mid
// glide with the letterbox bars in, beside the same spot with no moment,
// as `cine-<TAG>-<viewport>-<scene>.png`.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsCine.ts
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

const BASE = 'wave=8&start=wave&elapsed=3000&god&seen=all&px=180&py=60'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'still', query: `${BASE}&freeze=20` },
  {
    name: 'boss-door',
    query: `${BASE}&boss=arriving&door=Front&arriveMs=1300&freeze=1`,
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
        yield* shot(page, `cine-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
