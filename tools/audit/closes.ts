import { Array, Effect, Option, String } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Point,
  closeOverlaps,
  missedCloseFace,
  placeBuyButton,
  shopShapeOf,
} from './inPage/closes'
import {
  DESKTOP_1280,
  DESKTOP_1920,
  type Log,
  PHONE_844,
  type ScenePages,
  UPRIGHT_375,
  UPRIGHT_390,
  type Viewport,
  auditTag,
  deviceQuery,
  finish,
  forEachInOrder,
  harnessQuery,
  isPickedScene,
  loadScene,
  openBrowser,
  parallelFrom,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  waitForDialog,
  waitForLobby,
} from './lib'
import { type AuditFailed, attempt, failWith } from './page'

const VIEWPORTS = [
  { ...PHONE_844, name: 'l844', scale: 2 },
  { ...UPRIGHT_390, name: 'p390', scale: 2 },
  { ...UPRIGHT_375, name: 'p375' },
  DESKTOP_1280,
  DESKTOP_1920,
]

type Scene = Readonly<{
  name: string
  query: string
  open: ReadonlyArray<string>
  opensLobby?: boolean
}>

const MANOR = '#home-manor'
const LOBBY_QUERY = 'learned=move,fire&rank=300&calling=Handyman'

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'shop',
    query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142',
    open: [],
  },
  { name: 'hand', query: 'support', open: [MANOR] },
  { name: 'settings', query: 'fit=full&rotate', open: ['#home-settings'] },
  { name: 'whatsnew', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  {
    name: 'munchopedia',
    query: 'kills=Shambler:40,Runner:3',
    open: [MANOR, '#hand-card-munchopedia'],
  },
  {
    name: 'munchopedia-entry',
    query: 'kills=Shambler:40,Runner:3',
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile'],
  },
  {
    name: 'munchopedia-shop',
    query: 'kills=Shambler:40,Runner:3',
    open: [MANOR, '#hand-card-munchopedia', '#munch-shop-tile'],
  },
  { name: 'howto', query: '', open: [MANOR, '#hand-card-howtoplay'] },
  { name: 'character', query: '', open: [MANOR, '#hand-card-character'] },
  {
    name: 'hero',
    query: LOBBY_QUERY,
    open: ['#home-play', '#lobby-hero'],
    opensLobby: true,
  },
  { name: 'home-guide', query: 'fit=home', open: ['#home-install'] },
  { name: 'greet', query: 'greet', open: [] },
]

const MIN_SIDE = 48
const PHONE_FACE = { min: 26, max: 34 }
const DESKTOP_FACE = { min: 26, max: 40 }
const INSET = 2
const OPEN_TIMEOUT_MS = 10_000
const CLOSE_TIMEOUT_MS = 3000

const CLOSE = 'dialog[open] .menu-close:not(.menu-back)'

const OTHERS = Array.join(
  [
    'button',
    'a[href]',
    'input',
    '[role="tab"]',
    '[role="radio"]',
    '[tabindex]:not([tabindex="-1"]):not([role="tabpanel"])',
  ],
  ',',
)

const TEXTS = Array.join(
  [
    'h2',
    '.shop-greeting',
    '.shop-wallet',
    '.shop-keeper',
    '.panel-blurb',
    '[role="tablist"]',
    '.look-preview',
  ],
  ',',
)

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>
type Placed = Readonly<{
  button: Box
  face: Box
  points: ReadonlyArray<Readonly<{ name: string; point: Point }>>
}>

const CLOSE_TAGS = /^(ClosedDialog|RequestedClose\w*)$/

const isCloseTag = (tag: string) => CLOSE_TAGS.test(tag)
const TAP_LEAVES =
  /(^|:)(Clicked\w*|Selected\w*|Picked\w*|ClosedDialog|RequestedClose\w*|PressedPointer)$/

const press = (page: Page, viewport: Viewport, point: Point) =>
  attempt(() =>
    viewport.isPhone
      ? page.touchscreen.tap(point.x, point.y)
      : page.mouse.click(point.x, point.y),
  )

const openScene = (page: Page, viewport: Viewport, scene: Scene) =>
  Effect.gen(function* () {
    yield* settleAnimations(page)
    for (const [step, selector] of scene.open.entries()) {
      const locator = page.locator(selector).first()
      yield* attempt(() =>
        locator.waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
      ).pipe(Effect.ignore)
      const box = yield* attempt(() => locator.boundingBox())
      if (box === null) {
        return yield* failWith(
          `${scene.name}: nothing to open with ${selector}`,
        )
      }
      yield* press(page, viewport, {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      })
      yield* step === 0 && scene.opensLobby === true
        ? waitForLobby(page)
        : waitForDialog(page)
      yield* settleAnimations(page)
    }
    yield* attempt(() =>
      page
        .locator(CLOSE)
        .first()
        .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
    ).pipe(Effect.ignore)
    yield* settleAnimations(page)
  })

const freshScene = (pages: ScenePages, viewport: Viewport, scene: Scene) =>
  Effect.gen(function* () {
    const page = yield* pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    yield* openScene(page, viewport, scene)
    return page
  })

const placeClose = (page: Page) =>
  attempt((): Promise<Placed | null> =>
    page.evaluate(
      ({ selector, inset }) => {
        const button = document.querySelector(selector)
        const face = button?.querySelector('.menu-close-face')
        if (button === null || face === null || face === undefined) {
          return null
        }
        const toBox = (rect: DOMRect) => ({
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        })
        const b = toBox(button.getBoundingClientRect())
        const f = toBox(face.getBoundingClientRect())
        const center = {
          x: (f.left + f.right) / 2,
          y: (f.top + f.bottom) / 2,
        }
        return {
          button: b,
          face: f,
          points: [
            { name: 'face center', point: center },
            {
              name: 'face top left',
              point: { x: f.left + inset, y: f.top + inset },
            },
            {
              name: 'face bottom right',
              point: { x: f.right - inset, y: f.bottom - inset },
            },
            {
              name: 'hit top left',
              point: { x: b.left + inset, y: b.top + inset },
            },
            {
              name: 'hit top right',
              point: { x: b.right - inset, y: b.top + inset },
            },
            {
              name: 'hit bottom left',
              point: { x: b.left + inset, y: b.bottom - inset },
            },
            {
              name: 'hit bottom right',
              point: { x: b.right - inset, y: b.bottom - inset },
            },
            { name: 'hit left', point: { x: b.left + inset, y: center.y } },
            { name: 'hit right', point: { x: b.right - inset, y: center.y } },
            { name: 'hit top', point: { x: center.x, y: b.top + inset } },
            {
              name: 'hit bottom',
              point: { x: center.x, y: b.bottom - inset },
            },
          ],
        }
      },
      { selector: CLOSE, inset: INSET },
    ),
  )

const missedPoints = (page: Page, placed: Placed) =>
  attempt(() =>
    page.evaluate(missedCloseFace, { selector: CLOSE, points: placed.points }),
  )

const overlaps = (page: Page) =>
  attempt(() =>
    page.evaluate(closeOverlaps, {
      selector: CLOSE,
      others: OTHERS,
      texts: TEXTS,
    }),
  )

const isOnScreen = (page: Page, box: Box) =>
  attempt(() =>
    page.evaluate(
      rect =>
        rect.left >= -1 &&
        rect.top >= -1 &&
        rect.right <= innerWidth + 1 &&
        rect.bottom <= innerHeight + 1,
      box,
    ),
  )

const clearMessages = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      window.__messages.length = 0
    }),
  )

const messages = (page: Page) =>
  attempt((): Promise<ReadonlyArray<string>> =>
    page.evaluate(() => [...window.__messages]),
  )

const waitForClosed = (page: Page) =>
  attempt(() =>
    page.waitForFunction(
      () => document.querySelector('dialog[open]') === null,
      null,
      {
        timeout: CLOSE_TIMEOUT_MS,
      },
    ),
  ).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

type CloseAct = (page: Page, placed: Placed) => Effect.Effect<void, AuditFailed>

const checkClosing = (
  pages: ScenePages,
  viewport: Viewport,
  scene: Scene,
  how: string,
  act: CloseAct,
  log: Log,
) =>
  Effect.gen(function* () {
    const where = `${viewport.name} ${scene.name} ${how}`
    const page = yield* freshScene(pages, viewport, scene)
    const placed = yield* placeClose(page)
    if (placed === null) {
      pages.release(page)
      return [`${where}: no close button on reopen`]
    }
    yield* clearMessages(page)
    yield* act(page, placed)
    const isClosed = yield* waitForClosed(page)
    const tags = yield* messages(page)
    pages.release(page)
    const closes = Array.filter(tags, isCloseTag)
    const strays = Array.filter(
      tags,
      tag => TAP_LEAVES.test(tag) && !isCloseTag(tag),
    )
    const isOk = closes.length === 1 && strays.length === 0 && isClosed
    log(
      `${isOk ? 'ok  ' : 'FAIL'} ${where}: ${
        Array.join(
          Array.filter(tags, tag => TAP_LEAVES.test(tag)),
          ', ',
        ) || '(nothing)'
      }${isClosed ? '' : ', STILL OPEN'}`,
    )
    return isOk
      ? []
      : [
          `${where}: sent ${Array.join(tags, ', ') || 'nothing'}${isClosed ? '' : ' and the dialog stayed open'}`,
        ]
  })

const checkScene = (
  pages: ScenePages,
  tag: string,
  viewport: Viewport,
  scene: Scene,
  log: Log,
) =>
  Effect.gen(function* () {
    const problems: Array<string> = []
    const where = `${viewport.name} ${scene.name}`
    const page = yield* freshScene(pages, viewport, scene)
    const placed = yield* placeClose(page)
    yield* shot(page, `closes-${tag}-${viewport.name}-${scene.name}`)
    if (placed === null) {
      pages.release(page)
      return [`${where}: no shared close button in the open dialog`]
    }
    const width = placed.button.right - placed.button.left
    const height = placed.button.bottom - placed.button.top
    const face = Math.round(placed.face.right - placed.face.left)
    const range = viewport.isPhone ? PHONE_FACE : DESKTOP_FACE
    log(
      `${where}: button ${Math.round(width)}x${Math.round(height)}, face ${face} px`,
    )
    if (width < MIN_SIDE || height < MIN_SIDE) {
      problems.push(
        `${where}: the button is ${Math.round(width)}x${Math.round(height)}, under ${MIN_SIDE} px`,
      )
    }
    if (face < range.min || face > range.max) {
      problems.push(
        `${where}: the face is ${face} px, outside ${range.min} to ${range.max}`,
      )
    }
    const isShownWhole = yield* isOnScreen(page, placed.button)
    if (!isShownWhole) {
      problems.push(`${where}: the button is off screen`)
    }
    for (const miss of yield* missedPoints(page, placed)) {
      problems.push(`${where}: the ${miss}`)
    }
    for (const overlap of yield* overlaps(page)) {
      problems.push(`${where}: the close ${overlap}`)
    }
    pages.release(page)

    const tapPoints = ['face center', 'hit top left', 'hit bottom right']
    for (const name of tapPoints) {
      const tapProblems = yield* checkClosing(
        pages,
        viewport,
        scene,
        `${viewport.isPhone ? 'tap' : 'click'} ${name}`,
        (tapPage, placedNow) =>
          Option.match(
            Array.findFirst(placedNow.points, p => p.name === name),
            {
              onNone: () =>
                Effect.fail(failWith(`No ${name} point on the close button`)),
              onSome: placedPoint =>
                press(tapPage, viewport, placedPoint.point),
            },
          ),
        log,
      )
      problems.push(...tapProblems)
    }
    const escapeProblems = yield* checkClosing(
      pages,
      viewport,
      scene,
      'Escape',
      tapPage => attempt(() => tapPage.keyboard.press('Escape')),
      log,
    )
    problems.push(...escapeProblems)
    return problems
  })

type BuyRoute = Readonly<{ name: string; before: ReadonlyArray<string> }>

const BUY_ROUTES: ReadonlyArray<BuyRoute> = [
  { name: 'buy', before: [] },
  { name: 'buy-after-coop', before: ['', 'coop=hub'] },
]

const isBuyTap = (tag: string) => String.endsWith('ClickedBuyButton')(tag)

const shopShape = (page: Page) => attempt(() => page.evaluate(shopShapeOf))

const placeBuy = (page: Page) => attempt(() => page.evaluate(placeBuyButton))

const balanceText = (page: Page) =>
  attempt(() =>
    page.evaluate(
      () => document.querySelector('dialog[open] .shop-balance')?.textContent,
    ),
  )

const checkBuying = (
  pages: ScenePages,
  tag: string,
  shopQuery: string,
  viewport: Viewport,
  route: BuyRoute,
  log: Log,
) =>
  Effect.gen(function* () {
    const where = `${viewport.name} ${route.name}`
    const query = (part: string) => harnessQuery(part, deviceQuery(viewport))
    const [first, ...rest] = [...route.before, shopQuery]
    const page = yield* pages.open(viewport, query(first), {
      fresh: true,
    })
    for (const part of rest) {
      yield* loadScene(page, query(part))
    }
    yield* waitForDialog(page)
    yield* settleAnimations(page)
    const problems: Array<string> = []
    const shape = yield* shopShape(page)
    if (shape.shops !== 1 || shape.open !== 1) {
      problems.push(
        `${where}: ${shape.shops} shop dialogs and ${shape.open} open dialogs, not one of each`,
      )
    }
    if (shape.repeated.length > 0) {
      problems.push(
        `${where}: repeated ids ${Array.join(shape.repeated, ', ')}`,
      )
    }
    const placed = yield* placeBuy(page)
    if (placed === null) {
      yield* pages.discard(page)
      return [...problems, `${where}: no buy button to press`]
    }
    if (!placed.isHit) {
      problems.push(`${where}: the buy button's center hits ${placed.hit}`)
    }
    const before = yield* balanceText(page)
    yield* clearMessages(page)
    yield* press(page, viewport, placed.point)
    yield* attempt(() =>
      page.waitForFunction(
        shown =>
          document.querySelector('dialog[open] .shop-balance')?.textContent !==
          shown,
        before,
        { timeout: CLOSE_TIMEOUT_MS },
      ),
    ).pipe(Effect.ignore)
    const after = yield* balanceText(page)
    const tags = yield* messages(page)
    const buys = Array.filter(tags, isBuyTap)
    yield* shot(page, `closes-${tag}-${viewport.name}-${route.name}`)
    yield* pages.discard(page)
    if (buys.length !== 1) {
      problems.push(`${where}: the press sent ${buys.length} ClickedBuyButton`)
    }
    if (after === before) {
      problems.push(`${where}: the balance stayed at "${before}"`)
    }
    log(
      `${problems.length === 0 ? 'ok  ' : 'FAIL'} ${where}: ${before} -> ${after}`,
    )
    return problems
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const shop = yield* Effect.fromOption(
      Array.findFirst(SCENES, scene => scene.name === 'shop'),
    ).pipe(Effect.mapError(() => failWith('No shop scene')))
    const viewports = yield* pickViewports(VIEWPORTS)
    const scenes = yield* Effect.filter(SCENES, scene =>
      isPickedScene(scene.name),
    )
    const routes = yield* Effect.filter(BUY_ROUTES, route =>
      isPickedScene(route.name),
    )
    const parallel = yield* parallelFrom('CLOSES_PARALLEL')
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const units = Array.flatMap(viewports, viewport =>
      Array.map(scenes, scene => ({ viewport, scene })),
    )
    const buyUnits = Array.flatMap(viewports, viewport =>
      Array.map(routes, route => ({ viewport, route })),
    )
    const problems = yield* forEachInOrder(
      units,
      parallel,
      ({ viewport, scene }, log) =>
        checkScene(pages, tag, viewport, scene, log),
    )
    const buyProblems = yield* forEachInOrder(
      buyUnits,
      parallel,
      ({ viewport, route }, log) =>
        checkBuying(pages, tag, shop.query, viewport, route, log),
    )
    yield* pages.close
    yield* finish(
      [...Array.flatten(problems), ...Array.flatten(buyProblems)],
      'Every close button is small, clear of its dialog, and closes on one tap and on Escape, and the shop opens once and sells on one tap.',
    )
  }),
)
