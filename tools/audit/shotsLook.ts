// The look pass (src/render/iso/look.ts, lookSpecs.ts): the dining room and
// the cellar in a break, a hot wave, a frenzy, and a break with every room
// open, drawn the old way and with `lookpass`, as
// `look-<TAG>-<old|new>-<viewport>-<scene>.png`, so the dithered bands, the
// dark, and each room's colors can be set side by side.
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
]

const LOOKS: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'old', query: '' },
  { name: 'new', query: '&lookpass' },
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
        for (const look of LOOKS) {
          const page = yield* openPage(browser, viewport)
          yield* gotoScene(
            page,
            harnessUrl(
              `${BASE_QUERY}&${scene.query}${look.query}`,
              deviceQuery(viewport),
            ),
          )
          yield* shot(
            page,
            `look-${tag}-${look.name}-${viewport.name}-${scene.name}`,
          )
          yield* closePage(page)
        }
      }
    }
  }),
)
