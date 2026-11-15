// The kitchen's top right corner in a break: the break banner, the stove's
// feat lock and its count, the price tags by it, and Rattles' bubble, with
// the player by the stove and by the fridge, on a 1280x720 desktop, an
// 844x390 phone on its side, and a 390x844 phone held upright, as
// `corner-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsCorner.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  scenePages,
  settleAnimations,
  shot,
  shotViewports,
} from './lib'

const LEARNED =
  'seen=all&learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles,displayCase'
const BREAK = `wave=4&prep=19000&money=17&darefound=2&openexits=Kitchen&${LEARNED}`

type Scene = Readonly<{ name: string; query: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'stove', query: `${BREAK}&px=130&py=-80&tick=30` },
  { name: 'oven', query: `${BREAK}&px=100&py=-80&tick=30` },
  { name: 'fridge', query: `${BREAK}&px=170&py=-80&tick=30` },
  { name: 'fridge-low', query: `${BREAK}&px=150&py=-30&tick=300` },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
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
        yield* shot(page, `corner-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish([], 'Shots taken.')
  }),
)
