// The narrow phone pass: the menus on a 360x780 phone held upright and a
// 780x360 phone on its side, as `narrow-<TAG>-<viewport>-<scene>.png` in
// NARROW_SHOTS (default /tmp/narrow-shots). The shop with each tab, home,
// the PLAY lobby with the modifier row, the co-op lobby, the Profile's
// tabs, the Munchopedia with the Shop guide, and the end card. It exits with
// 1 when something in the open menu runs past the screen's edge, a box
// scrolls sideways, or (on the Look tab) a button is under 44 px.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsNarrow.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import type { Page } from 'playwright-core'

import {
  TAG,
  deviceQuery,
  finish,
  fromHand,
  harnessQuery,
  inOrder,
  isPickedScene,
  launch,
  openLobby,
  pickViewports,
  press,
  scenePages,
  settleAnimations,
  useHarness,
  wait,
} from './lib'

const SHOTS = process.env['NARROW_SHOTS'] ?? '/tmp/narrow-shots'

const VIEWPORTS = pickViewports([
  { name: 'p360', width: 360, height: 780, scale: 3, isPhone: true },
  { name: 'l780', width: 780, height: 360, scale: 3, isPhone: true },
])

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const SHOP = 'wave=5&money=180&gun=smg&tier=1&px=270&py=142'
const MIN_LOOK_TAP = 44

type Scene = Readonly<{
  name: string
  query: string
  act?: (page: Page) => Promise<void>
  isLook?: boolean
}>

// NOTE: a tap, not a click, so the game stays on its touch layout.
const tapTab = (name: RegExp) => async (page: Page) => {
  const tab = page.getByRole('tab', { name }).first()
  const box = (await tab.count()) === 0 ? null : await tab.boundingBox()
  if (box !== null) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
  }
  await settleAnimations(page)
}

const lobby = async (page: Page) => {
  await openLobby(page)
  await wait(500)
  await settleAnimations(page)
}

const PROFILE = `${LEARNED}&rank=2400&bones=120`

const SCENES: ReadonlyArray<Scene> = [
  { name: 'shop-guns', query: SHOP },
  { name: 'shop-traps', query: SHOP, act: tapTab(/^Traps,/) },
  { name: 'shop-health', query: SHOP, act: tapTab(/^Health,/) },
  { name: 'shop-fridge', query: SHOP, act: tapTab(/^Fridge,/) },
  { name: 'shop-house', query: SHOP, act: tapTab(/^House,/) },
  { name: 'home', query: LEARNED },
  { name: 'home-rank', query: `${LEARNED}&rank=1850` },
  {
    name: 'lobby',
    query: `${LEARNED}&rank=4200&calling=Handyman&mods=10`,
    act: lobby,
  },
  {
    name: 'lobby-bot',
    query: `${LEARNED}&rank=4200&calling=Handyman&lobbybots=1&mods=15`,
    act: lobby,
  },
  { name: 'coop-host', query: 'coop=host&mods=10' },
  { name: 'coop-guest', query: 'coop=guest&mods=9' },
  {
    name: 'look-body',
    query: `${PROFILE}&profile=look&looksection=Body`,
    isLook: true,
  },
  {
    name: 'look-hair',
    query: `${PROFILE}&profile=look&looksection=Hair`,
    isLook: true,
  },
  {
    name: 'look-outfit',
    query: `${PROFILE}&profile=look&looksection=Outfit`,
    isLook: true,
  },
  {
    name: 'look-gear',
    query: `${PROFILE}&profile=look&looksection=Gear`,
    isLook: true,
  },
  { name: 'name', query: `${PROFILE}&profile=name` },
  {
    name: 'account',
    query: `${PROFILE}&profile=account&sync=synced&devices=2`,
  },
  { name: 'settings', query: `${PROFILE}&profile=settings` },
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
  {
    name: 'end-solo',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=162&rankgain=129&mods=14&tick=400`,
  },
  {
    name: 'end-crew',
    query: `wave=10&phase=victory&stats&party=3&${LEARNED}&rank=2400&rankgain=204&mods=9&tick=400`,
  },
]

type Report = Readonly<{
  past: ReadonlyArray<string>
  sideways: ReadonlyArray<string>
  small: ReadonlyArray<string>
  pageScrolls: boolean
}>

const inspect = (page: Page, minTap: number): Promise<Report> =>
  page.evaluate((min: number) => {
    const root =
      document.querySelector('dialog[open]') ??
      document.querySelector('.coop') ??
      document.body
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')}:${(el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 24)}`
    // NOTE: the screen-reader text, the canvases, and the world behind a
    // menu are not the menu.
    const all = [root, ...root.querySelectorAll('*')].filter(el => {
      const box = el.getBoundingClientRect()
      return (
        box.width > 0 &&
        box.height > 0 &&
        el.closest('.sr-only, canvas, .world-window, .floor-layers') === null
      )
    })
    const past = all
      .filter(el => {
        const box = el.getBoundingClientRect()
        return box.right > innerWidth + 1 || box.left < -1
      })
      .slice(0, 8)
      .map(label)
    const sideways = all
      .filter(el => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      .filter(el => getComputedStyle(el).display !== 'inline')
      .slice(0, 8)
      .map(label)
    const small =
      min === 0
        ? []
        : [...root.querySelectorAll('button')]
            .filter(el => el.getBoundingClientRect().height > 0)
            .filter(el => el.getBoundingClientRect().height < min)
            .map(label)
    const scroller = document.scrollingElement ?? document.documentElement
    return {
      past,
      sideways,
      small,
      pageScrolls:
        scroller.scrollHeight > innerHeight + 1 ||
        scroller.scrollWidth > innerWidth + 1,
    }
  }, minTap)

const problems: Array<string> = []
await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev', 'tick=72'])
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await settleAnimations(page)
    if (scene.act !== undefined) {
      await scene.act(page)
    }
    await settleAnimations(page)
    const where = `${viewport.name} ${scene.name}`
    const report = await inspect(page, scene.isLook === true ? MIN_LOOK_TAP : 0)
    for (const item of report.past) {
      problems.push(`${where}: past the edge: ${item}`)
    }
    for (const item of report.sideways) {
      problems.push(`${where}: scrolls sideways: ${item}`)
    }
    for (const item of report.small) {
      problems.push(`${where}: under ${MIN_LOOK_TAP} px tall: ${item}`)
    }
    if (report.pageScrolls) {
      problems.push(`${where}: the page scrolls`)
    }
    await page.screenshot({
      path: `${SHOTS}/narrow-${TAG}-${viewport.name}-${scene.name}.png`,
      animations: 'disabled',
    })
    console.log(`shot ${where}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The narrow phone pass found no problems.')
