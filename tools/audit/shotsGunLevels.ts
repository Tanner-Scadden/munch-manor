// The gun levels pass (owner, 2026-11-10: "I am also very confused on how I
// do the upgrades for the weapon now."): the HUD's gun slots with their
// kills toward the next level part filled, the level up's pop, the first
// time hint as a gun nears its first level, a cooked gun's slot, and the
// pause screen's guns. On a 1280x720 desktop, an 844x390 phone on its side,
// and a 390x844 phone held upright, as `guns-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsGunLevels.ts
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
const WAVE = 'wave=3&start=wave&elapsed=4000&crowd=0&gun=smg'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'bars', query: `${LEARNED},gunLevel&${WAVE}&gunkills=70,24` },
  {
    name: 'levelup',
    query: `${LEARNED},gunLevel&${WAVE}&gunkills=70,40&levelup=1&calloutAge=60`,
  },
  { name: 'hint', query: `${LEARNED}&${WAVE}&gunkills=6,28` },
  {
    name: 'cooked',
    query: `${LEARNED},gunLevel&${WAVE}&gunkills=130,260&perk=Spicy`,
  },
  {
    name: 'pause',
    query: `${LEARNED},gunLevel&${WAVE}&gunkills=70,24&phase=paused`,
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
        yield* shot(page, `guns-${tag}-${viewport.name}-${scene.name}`)
      }
    }
  }),
)
