import { Array, Effect, String } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import { readLayout } from './inPage/shots33'
import {
  DESKTOP_1280,
  DESKTOP_1920,
  type Log,
  PHONE_667,
  PHONE_844,
  type ScenePages,
  type Viewport,
  auditTag,
  deviceQuery,
  finish,
  forEachInOrder,
  harnessQuery,
  isPickedScene,
  openBrowser,
  parallelFrom,
  scenePages,
  settleAnimations,
  settled,
  shot,
} from './lib'
import { attempt } from './page'

const VIEWPORTS: ReadonlyArray<Viewport> = [
  PHONE_667,
  { ...PHONE_844, scale: 2 },
  DESKTOP_1280,
  DESKTOP_1920,
]

const FOUND =
  'bests&kills=Shambler:1203,Runner:140,Tank:12,Exploder:9,Thrower:3,Boss:2&opened=Shambler,Tank'

const MANOR = '#home-manor'
const LOBBY_QUERY = 'learned=move,fire&rank=300&calling=Handyman'

type Scene = Readonly<{
  name: string
  query: string
  open?: ReadonlyArray<string>
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  {
    name: 'home-found',
    query: `${FOUND}&newentries=Thrower&fit=full&newer&newsseen`,
  },
  { name: 'home-endless', query: `${FOUND}&homemode=endless&newsseen` },
  {
    name: 'home-corner',
    query: `${FOUND}&fit=full&install&newer&newsseen`,
  },
  { name: 'home-guide', query: 'fit=home', open: ['#home-install'] },
  { name: 'greet', query: 'greet' },
  { name: 'hand', query: 'support', open: [MANOR] },
  { name: 'hand-found', query: `${FOUND}&newsseen`, open: [MANOR] },
  { name: 'whats-new', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  {
    name: 'whats-new-older',
    query: '',
    open: [MANOR, '#hand-card-whatsnew', '.news-older'],
  },
  {
    name: 'munchopedia-empty',
    query: '',
    open: [MANOR, '#hand-card-munchopedia'],
  },
  {
    name: 'munchopedia',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia'],
  },
  {
    name: 'entry-unlocked',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=0'],
  },
  {
    name: 'entry-locked',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=5'],
  },
  {
    name: 'entry-boss',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=6'],
  },
  { name: 'howto', query: '', open: [MANOR, '#hand-card-howtoplay'] },
  { name: 'settings', query: '', open: ['#home-settings'] },
  {
    name: 'settings-rotate',
    query: 'rotate&fit=full',
    open: ['#home-settings'],
  },
  { name: 'difficulty', query: 'ask', open: ['#home-play'] },
  { name: 'lobby', query: LOBBY_QUERY, open: ['#home-play'] },
  {
    name: 'lobby-hard',
    query: `${LOBBY_QUERY}&difficulty=Hard&nightmare=Unlocked`,
    open: ['#home-play'],
  },
  {
    name: 'lobby-endless',
    query: `${LOBBY_QUERY}&homemode=endless`,
    open: ['#home-play'],
  },
  { name: 'lobby-you', query: 'learned=move,fire', open: ['#home-play'] },
  {
    name: 'lobby-hero',
    query: LOBBY_QUERY,
    open: ['#home-play', '#lobby-hero'],
  },
  { name: 'shop', query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142' },
  { name: 'shop-broke', query: 'wave=3&money=12&gun=shotgun&px=270&py=142' },
  {
    name: 'shop-traps',
    query:
      'wave=5&money=180&gun=smg&tier=1&planks=West,North&plankhp=12&px=270&py=142',
    open: ['[role=tab] >> nth=2'],
  },
  {
    name: 'gameover-new-entry',
    query: 'wave=7&phase=gameover&stats&newentries=Crawler,Thrower',
  },
]

const MIN_SIDE = 48

const press = (
  page: Page,
  viewport: Viewport,
  selector: string,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const box = yield* attempt(() =>
      page.locator(selector).first().boundingBox(),
    )
    if (box === null) {
      problems.push(`nothing to open with ${selector}`)
      return
    }
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    yield* attempt(() =>
      viewport.isPhone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y),
    )
    yield* settleAnimations(page)
  })

const check = (page: Page, side: number, phone: boolean) =>
  attempt(() => page.evaluate(readLayout, { minSide: side, isPhone: phone }))

const checkViewport = (
  pages: ScenePages,
  tag: string,
  viewport: Viewport,
  log: Log,
) =>
  Effect.gen(function* () {
    const problems: Array<string> = []
    const playBoxes = new Map<string, string>()
    for (const scene of SCENES) {
      if (!(yield* isPickedScene(scene.name))) {
        continue
      }
      const page = yield* pages.open(
        viewport,
        harnessQuery(scene.query, deviceQuery(viewport)),
      )
      yield* settleAnimations(page)
      for (const selector of scene.open ?? []) {
        yield* press(page, viewport, selector, problems)
      }
      const found = yield* check(page, MIN_SIDE, viewport.isPhone)
      const name = `s33-${tag}-${viewport.name}-${scene.name}`
      yield* shot(page, name)
      playBoxes.set(scene.name, found.play)
      const notes = Array.filter(
        [
          found.small.length > 0
            ? `small: ${Array.join(found.small, ', ')}`
            : '',
          found.overlaps.length > 0
            ? `overlap: ${Array.join(found.overlaps, '; ')}`
            : '',
          found.panelScroll > 0 ? `panel scrolls ${found.panelScroll}px` : '',
          found.pageScroll > 0 ? `PAGE SCROLLS ${found.pageScroll}px` : '',
        ],
        Boolean,
      )
      log(`${name}  play ${found.play}  ${Array.join(notes, '  ')}`)
      if (found.small.length > 0 || found.overlaps.length > 0) {
        problems.push(`${name}: ${Array.join(notes, '  ')}`)
      }
      if (found.pageScroll > 0) {
        problems.push(`${name}: the page scrolls`)
      }
      if (
        String.startsWith('munchopedia')(scene.name) &&
        found.panelScroll > 0
      ) {
        problems.push(`${name}: the Munchopedia panel scrolls`)
      }
      pages.release(page)
    }
    const campaignPlay = playBoxes.get('home-found')
    const endlessPlay = playBoxes.get('home-endless')
    if (campaignPlay !== undefined && endlessPlay !== undefined) {
      const same = campaignPlay === endlessPlay
      log(
        `${viewport.name} PLAY campaign ${campaignPlay}, endless ${endlessPlay}: ${same ? 'same box' : 'MOVED'}`,
      )
      if (!same) {
        problems.push(`${viewport.name}: PLAY moves when the mode switches`)
      }
    }
    if (!viewport.isPhone && (yield* isPickedScene('focus'))) {
      const page = yield* pages.open(viewport, harnessQuery(FOUND, 'newsseen'))
      const order: Array<string> = []
      for (let step = 1; step <= 6; step++) {
        yield* attempt(() => page.keyboard.press('ArrowDown'))
        yield* settled(page)
        const focused = yield* attempt(() =>
          page.evaluate(() => document.activeElement?.id ?? '(none)'),
        )
        order.push(focused)
        yield* shot(page, `s33-${tag}-${viewport.name}-focus-${step}`)
      }
      const tabOrder: Array<string> = []
      yield* attempt(() => page.locator('#home-play').focus())
      for (let step = 0; step < 8; step++) {
        const focused = yield* attempt(() =>
          page.evaluate(() => {
            const active = document.activeElement
            if (active === null) {
              return '(none)'
            }
            if (active.id !== '') {
              return active.id
            }
            const label = active.getAttribute('aria-label')
            return label === null || label === '' ? '(none)' : label
          }),
        )
        tabOrder.push(focused)
        yield* attempt(() => page.keyboard.press('Tab'))
        yield* settled(page)
      }
      log(`${viewport.name} arrows: ${Array.join(order, ' > ')}`)
      log(`${viewport.name} tab: ${Array.join(tabOrder, ' > ')}`)
      pages.release(page)
    }
    return problems
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['tick=72'])
    const parallel = yield* parallelFrom('SHOTS_PARALLEL')
    const problems = yield* forEachInOrder(
      VIEWPORTS,
      parallel,
      (viewport, log) => checkViewport(pages, tag, viewport, log),
    )
    yield* pages.close
    yield* finish(Array.flatten(problems), 'The home layout is clean.')
  }),
)
