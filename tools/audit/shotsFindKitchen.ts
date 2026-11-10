// The "find the kitchen" pass: the boarded door up close with its light and
// steam, Rattles' bubble on screen and pinned at the edge, and the rooms
// counter in a break before and after the kitchen opens, on a 1280x720
// desktop, an 844x390 phone on its side, and a 390x844 phone held upright, as
// `sfk-<TAG>-<viewport>-<scene>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsFindKitchen.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Effect } from 'effect'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_390,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  wait,
} from './lib'
import { attempt } from './page'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'desktop' },
  { ...PHONE_844, name: 'phone-landscape' },
  { ...UPRIGHT_390, name: 'phone-portrait' },
])

const LEARNED =
  'seen=all&learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'
const BREAK = `wave=3&prep=40000&money=90&${LEARNED}`

type Scene = Readonly<{ name: string; query: string; hold?: string }>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'door-near', query: `${BREAK}&money=0&px=70&py=44&tick=450` },
  {
    name: 'door-padlock',
    query: `wave=2&prep=40000&${LEARNED}&px=70&py=44&tick=450`,
  },
  { name: 'bubble-in-view', query: `${BREAK}&px=100&py=90&tick=30` },
  { name: 'bubble-pinned', query: `${BREAK}&px=240&py=120&tick=30` },
  { name: 'counter-before', query: `${BREAK}&px=160&py=100&tick=30` },
  {
    name: 'counter-after',
    query: `${BREAK}&openexits=Kitchen&px=160&py=100&tick=30`,
  },
  {
    name: 'counter-sparkle',
    query: `${BREAK}&px=70&py=30&tick=10`,
    hold: 'KeyE',
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
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
        const { hold } = scene
        if (hold !== undefined) {
          yield* attempt(() => page.keyboard.down(hold))
          yield* wait(1500)
          yield* attempt(() => page.keyboard.up(hold))
          yield* wait(300)
        }
        yield* shot(page, `sfk-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish([], 'Shots taken.')
  }),
)
