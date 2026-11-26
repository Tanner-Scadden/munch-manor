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
const HOUSE = `god&nodev&seen=all&wave=3&openexits=West,East,Far,Kitchen&kitchen&${LEARNED}`
const BREAK = `${HOUSE}&break=open&nohud&tick=240`

const notesIn = (house: number, x: number, y: number) =>
  `${BREAK}&house=${house}&px=${x}&py=${y}`

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'hub', query: `${BREAK}&px=175&py=40` },
  { name: 'cobweb', query: `${BREAK}&px=310&py=55` },
  { name: 'notes-west-parlour', query: notesIn(0, -170, 120) },
  { name: 'notes-west-door', query: notesIn(0, -40, 150) },
  { name: 'notes-west-dining', query: notesIn(0, 70, 130) },
  { name: 'notes-east-parlour', query: notesIn(2, 440, 90) },
  { name: 'notes-east-door', query: notesIn(2, 370, 115) },
  { name: 'notes-east-dining', query: notesIn(2, 290, 110) },
  { name: 'notes-far-parlour', query: notesIn(3, 750, 95) },
  { name: 'notes-far-cellar', query: notesIn(3, 560, 105) },
  { name: 'notes-far-dining', query: notesIn(3, 300, 110) },
  { name: 'notes-far-library', query: notesIn(5, 520, 105) },
  { name: 'valve', query: `${BREAK}&px=170&py=-25` },
  { name: 'hearth', query: `${BREAK}&valve&px=-160&py=120` },
  { name: 'pickups', query: `${BREAK}&pickups=all&px=160&py=150` },
  { name: 'pantry', query: `${BREAK}&px=90&py=-80` },
  { name: 'crates', query: `${BREAK}&px=120&py=150` },
  {
    name: 'dare',
    query: `${BREAK}&difficulty=Easy&darenear=36`,
  },
  {
    name: 'traps',
    query: `${BREAK}&gnomes=15,12;20,13&planks=West,North&plankhp=12&px=180&py=150`,
  },
  {
    name: 'backdoor',
    query: `${BREAK}&darefound=1&px=170&py=-20`,
  },
  { name: 'rattles', query: `${BREAK}&px=215&py=170` },
  {
    name: 'cases',
    query: `${LEARNED}&wave=3&break=open&kills=Runner:3&px=44&py=150&nohud&tick=240`,
  },
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
        yield* shot(page, `stand-${tag}-${viewport.name}-${scene.name}`)
        yield* closePage(page)
      }
    }
  }),
)
