// The new player pass: what a first-timer sees at each step of a first
// run, from the dare card lobby to the pause screen: the guided first
// break's tracker on each of its steps (the key, the padlock, the case, the
// dare card, START WAVE), a display case's first-time card, the dining room's west case
// beside the boards' padlock, a later break, a later break with the keys
// for the kitchen and the edge arrow to its padlock, and the pause screen's How to
// play, on a 1280x720 desktop, an 844x390 phone on its side, and a 390x844
// phone held upright, as `np-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsNewPlayer.ts
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

const NEW = 'learned=move,fire,startWave,pickup,rattles'
const FIRST_BREAK = 'wave=2&break=open&breakMs=3000&seen=all&quest=running'
const SEEN =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles'
const LATER_BREAK = 'wave=3&break=open&kills=Runner:3'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'qkey', query: `${NEW}&${FIRST_BREAK}` },
  { name: 'qlock', query: `${NEW},dareKey&${FIRST_BREAK}&money=1` },
  {
    name: 'qcase',
    query: `${NEW},dareKey&${FIRST_BREAK}&openexits=Kitchen`,
  },
  { name: 'qcard', query: `${NEW},dareKey&${FIRST_BREAK}&quest=card` },
  { name: 'qstart', query: `${NEW},dareKey&${FIRST_BREAK}&quest=start` },
  { name: 'casecard', query: `${SEEN}&${LATER_BREAK}&px=40&py=150` },
  {
    name: 'glass',
    query: `${SEEN},displayCase&${LATER_BREAK}&px=44&py=150`,
  },
  {
    name: 'break3',
    query: `${SEEN},displayCase&wave=4&break=open&money=6&darefound=1`,
  },
  {
    name: 'padptr',
    query: `${SEEN},displayCase&wave=4&break=open&money=9&darefound=1&px=40&py=150`,
  },
  {
    name: 'pause',
    query: `${SEEN},displayCase&wave=3&start=wave&phase=paused`,
  },
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
        yield* shot(page, `np-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
