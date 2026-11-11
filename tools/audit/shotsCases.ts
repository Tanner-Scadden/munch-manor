// The display cases pass: the dining room's three cases in a break, the
// player beside the glass one and the trophy one, with each case's prize
// behind its glass and its feat's lock over it showing the player's own
// progress; and the first-time card a case raises in a break. On a
// 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone held
// upright, as `cases-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsCases.ts
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

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'
const BREAK = 'wave=3&break=open&kills=Runner:3'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'glass',
    query: `${LEARNED},displayCase&${BREAK}&px=44&py=150`,
  },
  {
    name: 'trophy',
    query: `${LEARNED},displayCase&${BREAK}&px=316&py=150`,
  },
  { name: 'card', query: `${LEARNED}&${BREAK}&px=40&py=150` },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev', 'tick=40'])
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
        yield* shot(page, `cases-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
