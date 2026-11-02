// The shop guide pass: the ? in Rattles' shop, the guide opened from it on
// the Guns tab (a gun with its bars and upgrade ladder), on Traps, on the
// fridge with every prize still ??? and again with two pulled, and on the
// house; and the Munchopedia's list with its Shop tile and the Shop page.
// On a 1280x720 desktop, an 844x390 phone on its side, and a 390x844 phone
// held upright, as `s50-<TAG>-<viewport>-<scene>.png`. It checks that each
// button in the open dialog is at least 48 px and that the page itself does
// not scroll, and exits with 1 on any miss.
//   TAG=after bun run heavy -- bun tools/audit/shots50.ts
// ONLY picks scenes, such as `ONLY=guns,fridge`, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  SHOT_VIEWPORTS,
  TAG,
  deviceQuery,
  finish,
  fromHand,
  harnessQuery,
  inOrder,
  isPickedScene,
  launch,
  press,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
} from './lib'

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page) => Promise<void>
}>

const SHOP = 'wave=5&money=180&gun=smg&tier=1&px=270&py=142'
const MIN_SIDE = 48

const GUIDE = press('Shop guide')

const SCENES: ReadonlyArray<Scene> = [
  { name: 'help', query: SHOP },
  { name: 'guns', query: SHOP, act: GUIDE },
  {
    name: 'traps',
    query: SHOP,
    act: inOrder(GUIDE, press('Traps')),
  },
  {
    name: 'health',
    query: SHOP,
    act: inOrder(GUIDE, press('Health')),
  },
  {
    name: 'fridge',
    query: SHOP,
    act: inOrder(GUIDE, press('Fridge')),
  },
  {
    name: 'fridge-pulled',
    query: `${SHOP}&prizes=Cooker,Freeze`,
    act: inOrder(GUIDE, press('Fridge')),
  },
  {
    name: 'house',
    query: SHOP,
    act: inOrder(GUIDE, press('House')),
  },
  {
    name: 'munch-list',
    query: 'kills=Shambler:40,Runner:12',
    act: fromHand(/munchopedia/i),
  },
  {
    name: 'munch-shop',
    query: 'kills=Shambler:40,Runner:12',
    act: inOrder(fromHand(/munchopedia/i), press(/^shop,/i)),
  },
]

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev', 'tick=72'])
const problems: Array<string> = []
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    if (scene.act !== undefined) {
      await scene.act(page)
    }
    await settleAnimations(page)
    const label = `${viewport.name} ${scene.name}`
    const report = await page.evaluate(() => {
      const dialog = document.querySelector('dialog[open]')
      const scroller = document.scrollingElement ?? document.documentElement
      const buttons = Array.from(
        dialog?.querySelectorAll<HTMLElement>('button') ?? [],
      )
        .filter(button => button.getBoundingClientRect().width > 0)
        .map(button => {
          const box = button.getBoundingClientRect()
          return {
            name: (button.getAttribute('aria-label') ?? button.innerText).slice(
              0,
              30,
            ),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        })
      return { buttons, pageScrolls: scroller.scrollHeight > innerHeight + 1 }
    })
    if (viewport.isPhone) {
      for (const button of report.buttons) {
        if (button.width < MIN_SIDE || button.height < MIN_SIDE) {
          problems.push(
            `${label}: "${button.name}" is ${button.width}x${button.height}`,
          )
        }
      }
    }
    if (report.pageScrolls) {
      problems.push(`${label}: the page scrolls`)
    }
    await shot(page, `s50-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}: ${report.buttons.length} buttons`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The shop guide pass found no problems.')
