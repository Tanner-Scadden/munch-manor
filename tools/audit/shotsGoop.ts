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
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,displayCase'
const HOUSE = `god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen&${LEARNED}`
const BREAK = `${HOUSE}&break=open&freeze=20`

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'soup', query: `${BREAK}&px=110&py=-55` },
  {
    name: 'slip',
    query: `${HOUSE}&start=wave&elapsed=6000&slip&px=110&py=-55&freeze=20`,
  },
  {
    name: 'souppot',
    query: `${HOUSE}&start=wave&elapsed=6000&tool=SoupPot&firedms=600&px=120&py=-60&freeze=20`,
  },
  {
    name: 'planks',
    query: `${BREAK}&planks=West,North&plankhp=30&px=280&py=55`,
  },
  {
    name: 'planks-cracked',
    query: `${BREAK}&planks=West,North&plankhp=12&px=280&py=55`,
  },
  {
    name: 'gnomes',
    query: `${BREAK}&gnomes=15,12;20,13;12,16&px=180&py=150`,
  },
  {
    name: 'ghost',
    query: `${BREAK}&turrets=2&barricades=2&traphint=Turret&px=180&py=150`,
  },
  { name: 'kitchen', query: `${BREAK}&px=160&py=-75` },
  { name: 'stacks', query: `${BREAK}&px=500&py=110` },
  {
    name: 'heap',
    query: `${HOUSE}&start=wave&elapsed=6000&tool=NorthStack&firedms=1500&px=500&py=110&freeze=20`,
  },
  {
    name: 'cases',
    query: `${LEARNED}&wave=3&break=open&kills=Runner:3&px=44&py=150&freeze=20`,
  },
  {
    name: 'parlour-find',
    query: `${BREAK}&findroom=Parlour&findwork=0.4&findgap=20`,
  },
  {
    name: 'library-find',
    query: `${BREAK}&findroom=Library&findwork=0.4&findgap=20`,
  },
  {
    name: 'kitchen-find',
    query: `${BREAK}&findroom=Kitchen&findwork=0.4&findgap=20`,
  },
  { name: 'door', query: `${BREAK}&px=180&py=190` },
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
        yield* shot(page, `goop-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
