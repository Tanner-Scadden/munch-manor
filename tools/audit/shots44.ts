// The ammo window pass: mid-wave at Rattles' stall, the AMMO sign over the
// counter with Rattles asleep while the player is away, awake with the tag
// (the box of rounds and the price) when they walk up with a low
// Chatterbox, the ring filling as they stand, the sale (the rounds sliding
// across and Rattles' line), and FULL for a full gun, on a 1280x720 desktop
// and a 390x844 phone held upright, as `s44-<TAG>-<viewport>-<scene>.png`.
// It checks that a hold at the window buys the rounds, and exits with 1 on
// a miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots44.ts
import type { Page } from 'playwright-core'

import { focusOf } from '@game/party'

import {
  DESKTOP_1280,
  TAG,
  UPRIGHT_390,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  pickViewports,
  scenePages,
  shot,
  useHarness,
} from './lib'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...UPRIGHT_390, name: 'p390' },
])

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page, problems: Array<string>, label: string) => Promise<void>
}>

// NOTE: the stall stands at x 260 to 280, y 150 to 170, so (270, 176) is
// just below its counter, in reach of the window, and (220, 120) is away.
const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const MID_WAVE = `wave=5&seen=all&start=wave&elapsed=20000&god&money=120&gun=smg&${LEARNED}`
const AT_WINDOW = 'px=270&py=176'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'asleep',
    query: `${MID_WAVE}&rounds=20&px=220&py=120&tick=20`,
  },
  {
    name: 'awake',
    query: `${MID_WAVE}&rounds=20&${AT_WINDOW}&stick=0,-30&tick=4`,
  },
  {
    name: 'standing',
    query: `${MID_WAVE}&rounds=20&${AT_WINDOW}&tick=40`,
  },
  {
    name: 'sale',
    query: `${MID_WAVE}&rounds=20&${AT_WINDOW}&hold&tick=44`,
    act: async (page, problems, label) => {
      const balance = await page.evaluate(
        () => focusOf(window.__model).wallet.balance,
      )
      if (balance >= 120) {
        problems.push(`${label}: holding at the ammo window did not buy`)
      }
    },
  },
  {
    name: 'full',
    query: `${MID_WAVE}&rounds=360&${AT_WINDOW}&tick=20`,
  },
]

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
const problems: Array<string> = []
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    const label = `${viewport.name} ${scene.name}`
    if (scene.act !== undefined) {
      await scene.act(page, problems, label)
    }
    await shot(page, `s44-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The ammo window pass found no problems.')
