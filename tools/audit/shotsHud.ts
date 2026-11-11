// The in-run HUD pass: the pocket shut mid-wave (hearts, the key count, the
// wave, and the dare chip with how many are found), the boss's wave, a break
// with the pocket open on the full list, a break under the WAVE CLEARED
// banner, the guided first break's look at the card, and a mid-wave with
// boosts up, on a 1280x720 desktop, an 844x390 phone on its side, and a
// 390x844 phone held upright, as `hud-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsHud.ts
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
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles,displayCase'
const FOUND = 'darefound=2&money=3'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave',
    query: `${LEARNED}&${FOUND}&wave=4&start=wave&elapsed=6000&crowd=8&god`,
  },
  {
    name: 'boost',
    query: `${LEARNED}&${FOUND}&wave=4&start=wave&elapsed=6000&crowd=8&god&boosts=RapidFire,Damage,Pierce`,
  },
  {
    name: 'boss',
    query: `${LEARNED}&${FOUND}&wave=8&start=wave&elapsed=6000&boss=fighting&god`,
  },
  {
    name: 'break',
    query: `${LEARNED}&${FOUND}&wave=3&prep=12000&seen=all`,
  },
  {
    name: 'cleared',
    query: `${LEARNED}&${FOUND}&wave=3&seen=all`,
  },
  {
    name: 'none',
    query: `${LEARNED}&money=12&wave=3&prep=12000&seen=all`,
  },
  {
    name: 'quest',
    query: `learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareKey,rattles,displayCase&quest=card&money=1&wave=2&break=open&breakMs=6000&seen=all`,
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
        yield* shot(page, `hud-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
