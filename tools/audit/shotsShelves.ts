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

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,displayCase,rattles'
const BREAK = `god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen&${LEARNED}&house=0&break=open&nohud&tick=240`

const beside = (x: number, y: number) => `${BREAK}&px=${x}&py=${y}`

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'kitchen-pantry', query: beside(45, -104) },
  { name: 'kitchen-pantry-front', query: beside(25, -105) },
  { name: 'kitchen-fridge', query: beside(165, -102) },
  { name: 'parlour-bookshelf', query: beside(-35, 78) },
  { name: 'parlour-piano', query: beside(-268, 78) },
  { name: 'dining-cabinet', query: beside(48, 72) },
  { name: 'dining-cabinet-front', query: beside(25, 85) },
  { name: 'dining-sideboard', query: beside(180, 40) },
  { name: 'dining-south-cabinet', query: beside(35, 195) },
  { name: 'library-stacks', query: beside(418, 60) },
  { name: 'cellar-racks', query: beside(740, 58) },
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
        yield* shot(page, `shelves-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
