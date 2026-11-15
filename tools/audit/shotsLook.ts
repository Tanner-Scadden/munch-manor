// The look pass (src/render/iso/look.ts, lookSpecs.ts): every room in a
// break or a hot wave, the dining room in a frenzy, and the cellar dark and
// lit, as `look-<TAG>-<viewport>-<scene>.png`, so a change to the dithered
// bands, the dark, or a room's colors can be set beside an earlier TAG.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsLook.ts
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

const BASE_QUERY =
  'god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen'

// NOTE: the cellar is the far room in the first house (ARRANGEMENTS in
// src/world/level/plan.ts), from x 680 to 1000; `tool=Bulb` with `firedms`
// burns its bulb.
const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'dining-break', query: 'px=180&py=150&break=open&freeze=20' },
  {
    name: 'dining-wave',
    query: 'px=180&py=150&start=wave&heat=0.8&crowd=12&freeze=20',
  },
  {
    name: 'dining-frenzy',
    query: 'px=180&py=150&start=wave&heat=0.8&crowd=12&frenzy&freeze=20',
  },
  {
    name: 'cellar-dark',
    query: 'px=780&py=110&start=wave&heat=0.8&crowd=8&crowdx=680&freeze=20',
  },
  {
    name: 'cellar-lit',
    query:
      'px=780&py=110&start=wave&heat=0.8&crowd=8&crowdx=680&tool=Bulb&firedms=200&freeze=20',
  },
  {
    name: 'cellar-break',
    query: 'px=840&py=110&break=open&tool=Bulb&firedms=200&freeze=20',
  },
  { name: 'library-break', query: 'px=520&py=90&break=open&freeze=20' },
  {
    name: 'kitchen-wave',
    query:
      'px=160&py=-75&start=wave&heat=0.8&crowd=8&crowdx=20&crowdy=-130&freeze=20',
  },
  { name: 'parlour-break', query: 'px=-160&py=130&break=open&freeze=20' },
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
        yield* gotoScene(
          page,
          harnessUrl(`${BASE_QUERY}&${scene.query}`, deviceQuery(viewport)),
        )
        yield* shot(page, `look-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
