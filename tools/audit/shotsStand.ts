// What still lay flat or stood as a flat cutout in 3D, stood up: the
// dining room's hub touches (the dumbwaiter's hatch, the borrowed books, the
// parlour's notes, the cellar's cobweb and dust), the gas valve on the
// kitchen wall, the roaring hearth and its floor flames, and the house's
// other fixed sprites (the pickups, the pantry's goodie, the crates and
// their finds, the cases, the dare things in plain sight, the traps, the
// back door's EXIT sign, and Rattles' trunk), as
// `stand-<TAG>-<viewport>-<scene>.png`. Set beside an earlier TAG for a
// before and after, and zoom in on each to look for flat cutouts and seams.
//   TAG=try bun run heavy -- --shared bun tools/audit/shotsStand.ts
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
const breakAt = (tick: number) => `${HOUSE}&break=open&nohud&tick=${tick}`
const BREAK = breakAt(240)

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'hub', query: `${BREAK}&px=175&py=40` },
  { name: 'cobweb', query: `${BREAK}&px=310&py=55` },
  { name: 'notes', query: `${BREAK}&px=60&py=110` },
  // NOTE: the parlour's notes from a few spots, each note of the cycle:
  // the first half way up its rise, from the south and from far off east.
  { name: 'notes-rise', query: `${breakAt(120)}&px=60&py=110` },
  { name: 'notes-south', query: `${breakAt(120)}&px=40&py=200` },
  { name: 'notes-far', query: `${BREAK}&px=150&py=150` },
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
