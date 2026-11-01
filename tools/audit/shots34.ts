// The portrait pass: a wave, a break with the door preview, the shop, the
// home menu and its MANOR hand, the boss fight, pause, Game Over, and the
// menu panels, on three
// portrait phones (390x844, 430x932, 360x800, 375x667) and a landscape one (844x390),
// all with touch, as `s34-<TAG>-<viewport>-<scene>.png`. For every visible
// button it checks that it is at least 48 px and that its center hits it, and
// it checks that the page and the open dialog do not scroll. Exits with 1 on
// any problem.
//   TAG=after bun shots34.ts
// ONLY picks scenes, such as `ONLY=wave,break`, and VIEWPORTS picks phones,
// such as `VIEWPORTS=p390,l844`. SHOTS_PARALLEL sets how many scenes run at
// once, each in its own browser context (3 by default).
import type { Page } from 'playwright-core'

import {
  type Log,
  PHONE_844,
  TAG,
  UPRIGHT_360,
  UPRIGHT_375,
  UPRIGHT_390,
  UPRIGHT_430,
  type Viewport,
  finish,
  forEachInOrder,
  isPickedScene,
  launch,
  parallelFrom,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
} from './lib'

const VIEWPORTS = pickViewports([
  { ...UPRIGHT_390, name: 'p390' },
  { ...UPRIGHT_430, name: 'p430' },
  { ...UPRIGHT_360, name: 'p360' },
  { ...UPRIGHT_375, name: 'p375' },
  { ...PHONE_844, name: 'l844' },
])

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page) => Promise<void>
}>

const clickButton = (name: RegExp) => async (page: Page) => {
  await page.getByRole('button', { name }).first().click()
  await page.locator('dialog[open]').first().waitFor({ state: 'visible' })
}

const fromHand = (name: RegExp) => async (page: Page) => {
  await clickButton(/^more/i)(page)
  await clickButton(name)(page)
}

// NOTE: a tap, not a click, so the game stays on its touch layout.
const tapTab = (name: RegExp) => async (page: Page) => {
  const box = await page.getByRole('tab', { name }).first().boundingBox()
  if (box !== null) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  }
  await settleAnimations(page)
}

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'wave',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&crowd=10&tough&px=150&py=110&aim=250,90',
  },
  {
    name: 'lowammo',
    query:
      'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9&boosts=RapidFire,Damage,Speed,Pierce&px=60&py=110',
  },
  {
    name: 'break',
    query:
      'wave=3&seen=all&gun=smg&money=120&barricades=1&turrets=1&px=60&py=100',
  },
  {
    name: 'breakright',
    query: 'wave=7&seen=all&gun=smg&money=120&px=280&py=60',
  },
  {
    name: 'firstbreak',
    query: 'wave=2&seen=all&money=45&barricades=1&break=open&px=200&py=40',
  },
  { name: 'shop', query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142' },
  {
    name: 'shoptraps',
    query:
      'wave=5&money=180&gun=smg&tier=1&planks=West,North&plankhp=12&px=270&py=142',
    act: tapTab(/^Traps,/),
  },
  { name: 'home', query: '' },
  { name: 'home-rank', query: 'rank=1850' },
  {
    name: 'bests',
    query: 'bests&kills=Shambler:40,Runner:12&newentries=Runner',
  },
  {
    name: 'home-corner',
    query: 'bests&kills=Shambler:40,Runner:12&fit=full&install&newer',
  },
  {
    name: 'home-guide',
    query: 'fit=home',
    act: clickButton(/add to home screen/i),
  },
  { name: 'greet', query: 'greet' },
  {
    name: 'boss',
    query:
      'wave=8&seen=all&start=wave&elapsed=9000&boss=stomp&windMs=500&bx=200&by=80&px=150&py=120',
  },
  {
    name: 'card',
    query: 'wave=2&start=wave&seen=Shambler&card=2000',
  },
  { name: 'pause', query: 'wave=3&seen=all&start=wave&phase=paused' },
  { name: 'gameover', query: 'wave=5&phase=gameover&stats' },
  { name: 'victory', query: 'wave=8&phase=victory&stats' },
  { name: 'hand', query: 'support', act: clickButton(/^more/i) },
  { name: 'whatsnew', query: '', act: fromHand(/what's new/i) },
  {
    name: 'munchopedia',
    query: 'kills=Shambler:40,Runner:12',
    act: fromHand(/munchopedia/i),
  },
  { name: 'character', query: '', act: fromHand(/^character/i) },
  { name: 'howto', query: '', act: fromHand(/how to play/i) },
  { name: 'settings', query: '', act: clickButton(/settings/i) },
  {
    name: 'settings-rotate',
    query: 'rotate&fit=full',
    act: clickButton(/settings/i),
  },
  { name: 'difficulty', query: '', act: clickButton(/difficulty/i) },
]

const MIN_SIDE = 48

await useHarness()
const browser = await launch()

// NOTE: every scene plays 72 frames (1.2 s) at once and holds there, so the
// pictures are the same on every run, and a page per screen and worker
// switches scenes in place.
const pages = scenePages(browser, ['device=touch', 'nodev', 'tick=72'])

const checkScene = async (
  viewport: Viewport,
  scene: Scene,
  log: Log,
): Promise<ReadonlyArray<string>> => {
  const problems: Array<string> = []
  const page = await pages.open(viewport, scene.query)
  if (scene.act !== undefined) {
    await scene.act(page)
  }
  await settleAnimations(page)
  const report = await page.evaluate(() => {
    const isShown = (element: Element) => {
      const box = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return (
        box.width > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      )
    }
    const isInScroller = (element: Element): boolean => {
      const parent = element.parentElement
      if (parent === null) {
        return false
      }
      const overflow = getComputedStyle(parent).overflowY
      return (
        ((overflow === 'auto' || overflow === 'scroll') &&
          parent.scrollHeight > parent.clientHeight) ||
        isInScroller(parent)
      )
    }
    const openDialog = document.querySelector('dialog[open]')
    const buttons = Array.from(
      document.querySelectorAll<HTMLElement>('button, a.home-support'),
    )
      .filter(isShown)
      .filter(button =>
        openDialog === null
          ? button.closest('dialog') === null
          : openDialog.contains(button),
      )
      .map(button => {
        const box = button.getBoundingClientRect()
        const hit = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        )
        return {
          name: (button.getAttribute('aria-label') ?? button.innerText)
            .replace(/\s+/g, ' ')
            .slice(0, 40),
          width: Math.round(box.width),
          height: Math.round(box.height),
          isHit:
            (hit !== null && button.contains(hit)) ||
            (isInScroller(button) && (box.bottom > innerHeight || box.y < 0)),
          isOnScreen:
            isInScroller(button) ||
            (box.x >= -1 &&
              box.y >= -1 &&
              box.right <= innerWidth + 1 &&
              box.bottom <= innerHeight + 1),
        }
      })
    const scroller = document.scrollingElement ?? document.documentElement
    const pageScrolls = scroller.scrollHeight > innerHeight + 1
    const panels = Array.from(
      document.querySelectorAll('dialog[open], dialog[open] > *'),
    ).filter(element => {
      const box = element.getBoundingClientRect()
      return box.bottom > innerHeight + 1 || box.right > innerWidth + 1
    })
    return {
      buttons,
      pageScrolls,
      offScreen: panels.length,
      layout:
        document.querySelector('.game-root')?.getAttribute('data-layout') ?? '',
    }
  })
  await shot(page, `s34-${TAG}-${viewport.name}-${scene.name}`)
  const where = `${viewport.name} ${scene.name}`
  log(
    `${where} (${report.layout}): ${report.buttons.length} buttons${report.pageScrolls ? ', PAGE SCROLLS' : ''}`,
  )
  if (report.pageScrolls) {
    problems.push(`${where}: the page scrolls`)
  }
  if (report.offScreen > 0) {
    problems.push(`${where}: ${report.offScreen} dialog parts off screen`)
  }
  for (const button of report.buttons) {
    if (button.width < MIN_SIDE || button.height < MIN_SIDE) {
      problems.push(
        `${where}: "${button.name}" is ${button.width}x${button.height}`,
      )
    }
    if (!button.isHit) {
      problems.push(`${where}: "${button.name}" is covered at its center`)
    }
    if (!button.isOnScreen) {
      problems.push(`${where}: "${button.name}" is off screen`)
    }
  }
  pages.release(page)
  return problems
}

const UNITS = VIEWPORTS.flatMap(viewport =>
  SCENES.filter(scene => isPickedScene(scene.name)).map(scene => ({
    viewport,
    scene,
  })),
)

const problems = await forEachInOrder(
  UNITS,
  parallelFrom('SHOTS_PARALLEL'),
  ({ viewport, scene }, log) => checkScene(viewport, scene, log),
)
await pages.close()
await browser.close()

finish(problems.flat(), 'no problems')
