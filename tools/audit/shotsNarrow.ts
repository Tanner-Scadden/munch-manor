// The narrow phone pass: the menus on a 360x780 phone held upright and a
// 780x360 phone on its side, as `narrow-<TAG>-<viewport>-<scene>.png` in
// NARROW_SHOTS (default /tmp/narrow-shots). The shop with each tab, home,
// the PLAY lobby with the modifier row, the co-op lobby, the Profile's
// tabs, the Munchopedia with the Shop guide, and the end card. It exits with
// 1 when something in the open menu runs past the screen's edge, a box
// scrolls sideways, or (on the Look tab) a button is under 44 px.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsNarrow.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Config, Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Act,
  auditTag,
  deviceQuery,
  finish,
  fromHand,
  harnessQuery,
  inOrder,
  isPickedScene,
  openBrowser,
  openLobby,
  pickViewports,
  press,
  scenePages,
  settleAnimations,
  wait,
} from './lib'
import { attempt } from './page'

const VIEWPORTS = pickViewports([
  { name: 'p360', width: 360, height: 780, scale: 3, isPhone: true },
  { name: 'l780', width: 780, height: 360, scale: 3, isPhone: true },
])

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'
const SHOP = 'wave=5&money=180&gun=smg&tier=1&px=270&py=142'
const MIN_LOOK_TAP = 44

type Scene = Readonly<{
  name: string
  query: string
  act?: Act
  isLook?: boolean
}>

// NOTE: a tap, not a click, so the game stays on its touch layout.
const tapTab =
  (name: RegExp): Act =>
  page =>
    Effect.gen(function* () {
      const tab = page.getByRole('tab', { name }).first()
      const count = yield* attempt(() => tab.count())
      const box = count === 0 ? null : yield* attempt(() => tab.boundingBox())
      if (box !== null) {
        yield* attempt(() =>
          page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2),
        )
      }
      yield* settleAnimations(page)
    })

const lobby: Act = page =>
  Effect.gen(function* () {
    yield* openLobby(page)
    yield* wait(500)
    yield* settleAnimations(page)
  })

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
    query: `wave=10&phase=escaped&stats&party=3&${LEARNED}&rank=2400&rankgain=204&mods=9&tick=400`,
  },
]

type Report = Readonly<{
  past: ReadonlyArray<string>
  sideways: ReadonlyArray<string>
  small: ReadonlyArray<string>
  pageScrolls: boolean
}>

const inspect = (page: Page, minTap: number) =>
  attempt((): Promise<Report> =>
    page.evaluate((min: number) => {
      // NOTE: this runs in the page, where Effect's modules are not loaded,
      // so it reads the elements with plain loops and the page's own String.
      const root =
        document.querySelector('dialog[open]') ??
        document.querySelector('.coop') ??
        document.body
      const label = (el: Element) => {
        const classes = globalThis.String(el.className)
        const name = el.getAttribute('aria-label') ?? el.textContent
        // NOTE: runs in the page, where Effect's String is not loaded.
        // @effect-diagnostics-next-line preferEffectString:off
        return `${el.tagName.toLowerCase()}.${classes.replaceAll(' ', '.')}:${name.trim().slice(0, 24)}`
      }
      const MAX_LISTED = 8
      const past: Array<string> = []
      const sideways: Array<string> = []
      // NOTE: the screen-reader text, the canvases, and the world behind a
      // menu are not the menu.
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const box = el.getBoundingClientRect()
        if (
          box.width <= 0 ||
          box.height <= 0 ||
          el.closest('.sr-only, canvas, .world-window, .floor-layers') !== null
        ) {
          continue
        }
        if (
          past.length < MAX_LISTED &&
          (box.right > innerWidth + 1 || box.left < -1)
        ) {
          past.push(label(el))
        }
        if (
          sideways.length < MAX_LISTED &&
          el.scrollWidth > el.clientWidth + 1 &&
          el.clientWidth > 0 &&
          getComputedStyle(el).display !== 'inline'
        ) {
          sideways.push(label(el))
        }
      }
      const small: Array<string> = []
      if (min !== 0) {
        for (const el of root.querySelectorAll('button')) {
          const height = el.getBoundingClientRect().height
          if (height > 0 && height < min) {
            small.push(label(el))
          }
        }
      }
      const scroller = document.scrollingElement ?? document.documentElement
      return {
        past,
        sideways,
        small,
        pageScrolls:
          scroller.scrollHeight > innerHeight + 1 ||
          scroller.scrollWidth > innerWidth + 1,
      }
    }, minTap),
  )

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
    const shots = yield* Config.String('NARROW_SHOTS').pipe(
      Config.withDefault('/tmp/narrow-shots'),
    )
    const browser = yield* openBrowser
    const problems: Array<string> = []
    const pages = scenePages(browser, ['nodev', 'tick=72'])
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
        if (scene.act !== undefined) {
          yield* scene.act(page)
        }
        yield* settleAnimations(page)
        const where = `${viewport.name} ${scene.name}`
        const report = yield* inspect(
          page,
          scene.isLook === true ? MIN_LOOK_TAP : 0,
        )
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
        yield* attempt(() =>
          page.screenshot({
            path: `${shots}/narrow-${tag}-${viewport.name}-${scene.name}.png`,
            animations: 'disabled',
          }),
        )
        yield* Console.log(`shot ${where}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The narrow phone pass found no problems.')
  }),
)
