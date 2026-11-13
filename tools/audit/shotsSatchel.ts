// The dare satchel pass: the dare card opened again from the HUD's list
// (src/features/dare/pocketCard.ts), with things found in its satchel and
// the rest dim with their rooms' icons, a new find dropping in, the whole
// list found, Triple Dare's card with no rooms shown, and a list rolled
// with the Dare Journal's new things. On a 1280x720
// desktop, an 844x390 phone on its side, and a 390x844 phone held upright,
// as `satchel-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsSatchel.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

type Scene = Readonly<{ name: string; query: string }>

const RUN = 'learned=move,fire,startWave,pickup,dareCard,dareTour&quest=done'
const WAVE = `${RUN}&wave=3&openexits=Kitchen,West`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'none', query: `${WAVE}&dareopen=2000` },
  { name: 'two', query: `${WAVE}&darefound=2&satchel=2&dareopen=2000` },
  { name: 'dropping', query: `${WAVE}&darefound=2&satchel=1&dareopen=500` },
  { name: 'all', query: `${WAVE}&darefound=6&satchel=6&dareopen=2000` },
  {
    name: 'newthings',
    query: `${WAVE}&newthings&difficulty=Hard&darefound=2&satchel=2&dareopen=2000`,
  },
  {
    name: 'triple',
    query: `${WAVE}&difficulty=Hard&darefound=1&satchel=1&dareopen=2000`,
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=2'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* settleAnimations(page)
        yield* shot(page, `satchel-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
