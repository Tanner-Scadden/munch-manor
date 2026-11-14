// The mood light (src/render/iso/mood.ts): the same room in a calm break, a
// wave at full heat, and a lightning strike, as
// `mood-<TAG>-<viewport>-<scene>.png`, so the light's turn can be judged.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsMood.ts
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

// NOTE: wave 5's first strike lands at about 2020 ms on the World's clock,
// so a clock of 1770 frozen 20 frames on lands in its first flick.
const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'break', query: 'wave=5&seen=all&god&freeze=20' },
  {
    name: 'wave',
    query:
      'wave=5&seen=all&start=wave&elapsed=6000&clock=9000&heat=1&god&crowd=12&freeze=20',
  },
  {
    name: 'strike',
    query:
      'wave=5&seen=all&start=wave&elapsed=6000&clock=1770&god&crowd=12&freeze=20',
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
        yield* shot(page, `mood-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
