// The close button pass: every menu dialog's shared close X (the shop, the
// MORE hand, Settings, What's New, the Munchopedia, an entry, and its Shop
// guide, How to play, the character picker, the lobby's hero picker, the
// install steps, and the update greeting) on an 844x390 landscape phone,
// 390x844 and 375x667 upright phones, all with touch, and 1280x720 and
// 1920x1080 with a mouse, as `closes-<TAG>-<viewport>-<scene>.png`.
// For each close it checks:
//   - the button is at least 48 px and on screen, and its visible face is
//     smaller (26 to 34 px on a phone, at most 40 px on a desktop),
//   - the face's center and corners and the hit area's edges and corners all
//     hit the button (document.elementFromPoint), so nothing covers it and a
//     tap just off the face still lands,
//   - the button's box does not cross any other button, link, or tab in the
//     dialog, or its title, Rattles' bubble, the wallet, or the tabs' text,
//   - a real tap (a click on a desktop) on the face's center and on two
//     opposite corners of the hit area each sends exactly one
//     ClickedCloseButton (the Dialog's, or the hero picker's own) and no
//     other tap Message, reaches nothing behind it, and closes the dialog,
//   - Escape sends one CanceledDialog (the Dialog's cancel) and closes the
//     dialog.
// Then it buys in the shop with a tap (a click on a desktop), opened from its
// query and again after co-op's screen (`buy` and `buy-after-coop`): there
// must be one `<dialog id="shop">`, one open dialog, no repeated id, a buy
// button that its center hits, and one ClickedBuyButton that spends money.
// Exits with 1 on any problem.
//   TAG=after bun run heavy -- bun tools/audit/closes.ts
// ONLY picks scenes, such as `ONLY=shop,hand`, VIEWPORTS picks screens
// (`l844`, `p390`, `p375`, `d1280`, `d1920`), and CLOSES_PARALLEL sets how
// many scenes run at once (3 by default).
import { Array, Effect, Option, String } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
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
  // NOTE: the first open step is PLAY, which opens the lobby, not a dialog.
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
  // NOTE: the difficulty panel opens only to ask a new player first, and
  // that question has no close (the lobby picks the difficulty after), so
  // it is not here.
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

// NOTE: BACK shares the close's look (`menu-close menu-back`) and stands
// before it on a Munchopedia entry and its Shop guide, so it is left out.
const CLOSE = 'dialog[open] .menu-close:not(.menu-back)'

// NOTE: what a close button must never cover: the dialog's other controls
// and the text a player reads first. A tab panel takes focus so it can
// scroll, but it is a frame around controls, not one, so only what is in it
// counts.
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

type Point = Readonly<{ x: number; y: number }>
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

// NOTE: how a close arrives, by Foldkit's Dialog Messages
// (@foldkit/ui's dialog): a tap on the shared X is the Dialog's
// ClickedCloseButton (the hero picker's own X sends its picker's
// ClickedCloseButton, which closes its Dialog), and Escape is the Dialog's
// CanceledDialog. Each tag is the delivery chain, such as
// `GotPanelDialogMessage:ClickedCloseButton`.
type CloseTag = 'ClickedCloseButton' | 'CanceledDialog'

const isCloseTag = (close: CloseTag) => (tag: string) =>
  String.endsWith(`:${close}`)(tag)
const TAP_LEAVES =
  /(^|:)(Clicked\w*|SelectedOption|SelectedTab|CanceledDialog|PressedPointer)$/

const press = (page: Page, viewport: Viewport, point: Point) =>
  attempt(() =>
    viewport.isPhone
      ? page.touchscreen.tap(point.x, point.y)
      : page.mouse.click(point.x, point.y),
  )

// NOTE: the harness's ready signal says the scene is in. A dialog the game
// opens itself, such as the shop on reaching the stall, is waited for by
// its close, and each tap that opens a dialog waits for it to open and
// settle, never for a fixed time.
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

// NOTE: every scene starts from its query with an empty save, switched in on
// a page of the same screen, whatever an earlier close left behind.
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

// NOTE: a close flush in a panel's corner has the corner of its target
// under the panel's rounded corner, which clips what the panel holds: no
// tap can land there, on the button or on anything else in the panel, so a
// point outside the clipping panel's rounded inner edge is left out.
const missedPoints = (page: Page, placed: Placed) =>
  attempt(() =>
    page.evaluate(
      ({ selector, points }) => {
        const button = document.querySelector(selector)
        const clipperOf = (element: Element | null): Element | null => {
          for (
            let at = element?.parentElement ?? null;
            at !== null;
            at = at.parentElement
          ) {
            const style = getComputedStyle(at)
            if (
              style.overflowX !== 'visible' ||
              style.overflowY !== 'visible'
            ) {
              return at
            }
          }
          return null
        }
        const clipper = clipperOf(button)
        const isClippedAway = (point: Point) => {
          if (clipper === null) {
            return false
          }
          const style = getComputedStyle(clipper)
          const box = clipper.getBoundingClientRect()
          const border = parseFloat(style.borderTopWidth)
          const top = box.top + border
          const bottom = box.bottom - border
          const left = box.left + border
          const right = box.right - border
          const corners = [
            {
              radius: style.borderTopLeftRadius,
              x: left,
              y: top,
              sx: 1,
              sy: 1,
            },
            {
              radius: style.borderTopRightRadius,
              x: right,
              y: top,
              sx: -1,
              sy: 1,
            },
            {
              radius: style.borderBottomLeftRadius,
              x: left,
              y: bottom,
              sx: 1,
              sy: -1,
            },
            {
              radius: style.borderBottomRightRadius,
              x: right,
              y: bottom,
              sx: -1,
              sy: -1,
            },
          ]
          // NOTE: runs in the page, which has no effect module.
          // @effect-diagnostics-next-line preferEffectArray:off
          return corners.some(corner => {
            const inner = Math.max(0, parseFloat(corner.radius) - border)
            const cx = corner.x + corner.sx * inner
            const cy = corner.y + corner.sy * inner
            const isInCornerSquare =
              (point.x - cx) * corner.sx < 0 && (point.y - cy) * corner.sy < 0
            return (
              isInCornerSquare && Math.hypot(point.x - cx, point.y - cy) > inner
            )
          })
        }
        const isMissed = ({ point }: { point: Point }) => {
          if (isClippedAway(point)) {
            return false
          }
          const hit = document.elementFromPoint(point.x, point.y)
          return button === null || hit === null || !button.contains(hit)
        }
        const describe = ({ name, point }: { name: string; point: Point }) => {
          const hit = document.elementFromPoint(point.x, point.y)
          // NOTE: runs in the page, which has no effect module.
          // @effect-diagnostics-next-line preferEffectString:off
          return `${name} hits ${hit === null ? 'nothing' : `${hit.tagName.toLowerCase()}.${hit.className}`}`
        }
        // NOTE: runs in the page, which has no effect module.
        // @effect-diagnostics-next-line preferEffectArray:off
        const missed = points.filter(isMissed)
        // NOTE: runs in the page, which has no effect module.
        // @effect-diagnostics-next-line preferEffectArray:off
        return missed.map(describe)
      },
      { selector: CLOSE, points: placed.points },
    ),
  )

// NOTE: text is measured by its own glyphs, not its block, since a title row
// that stops short of the close still spans the panel's width. Text only a
// screen reader reads is left out.
const overlaps = (page: Page) =>
  attempt(() =>
    page.evaluate(
      ({ selector, others, texts }) => {
        const close = document.querySelector(selector)
        const dialog = document.querySelector('dialog[open]')
        if (close === null || dialog === null) {
          return []
        }
        const c = close.getBoundingClientRect()
        const crosses = (r: DOMRect) =>
          r.width > 0 &&
          r.height > 0 &&
          r.left < c.right - 0.5 &&
          r.right > c.left + 0.5 &&
          r.top < c.bottom - 0.5 &&
          r.bottom > c.top + 0.5
        const isShown = (element: Element) => {
          const style = getComputedStyle(element)
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            element.closest('.sr-only') === null
          )
        }
        const name = (element: Element) =>
          (
            element.getAttribute('aria-label') ??
            (element instanceof HTMLElement
              ? element.innerText
              : element.className)
          )
            // NOTE: runs in the page, which has no effect module.
            // @effect-diagnostics-next-line preferEffectString:off
            .replace(/\s+/g, ' ')
            // NOTE: runs in the page, which has no effect module.
            // @effect-diagnostics-next-line preferEffectString:off
            .slice(0, 40)
        const found: Array<string> = []
        for (const other of globalThis.Array.from(
          dialog.querySelectorAll(others),
        )) {
          if (
            other === close ||
            close.contains(other) ||
            other.contains(close)
          ) {
            continue
          }
          if (isShown(other) && crosses(other.getBoundingClientRect())) {
            found.push(
              // NOTE: runs in the page, which has no effect module.
              // @effect-diagnostics-next-line preferEffectString:off
              `covers ${other.tagName.toLowerCase()} "${name(other)}"`,
            )
          }
        }
        for (const text of globalThis.Array.from(
          dialog.querySelectorAll(texts),
        )) {
          if (!isShown(text) || text.contains(close)) {
            continue
          }
          const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
          const rects: Array<DOMRect> = []
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if ((node.parentElement?.closest('.sr-only') ?? null) !== null) {
              continue
            }
            const range = document.createRange()
            range.selectNodeContents(node)
            rects.push(...globalThis.Array.from(range.getClientRects()))
          }
          const boxes =
            text.matches('.shop-keeper, .look-preview, [role="tablist"]') ||
            rects.length === 0
              ? [text.getBoundingClientRect()]
              : rects
          // NOTE: runs in the page, which has no effect module.
          // @effect-diagnostics-next-line preferEffectArray:off
          if (boxes.some(crosses)) {
            found.push(`covers the text "${name(text)}"`)
          }
        }
        return found
      },
      { selector: CLOSE, others: OTHERS, texts: TEXTS },
    ),
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

// NOTE: one fresh scene per tap, since the tap closes the dialog.
const checkClosing = (
  pages: ScenePages,
  viewport: Viewport,
  scene: Scene,
  how: string,
  close: CloseTag,
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
    const closes = Array.filter(tags, isCloseTag(close))
    const strays = Array.filter(
      tags,
      tag => TAP_LEAVES.test(tag) && !isCloseTag(close)(tag),
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
        'ClickedCloseButton',
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
      'CanceledDialog',
      tapPage => attempt(() => tapPage.keyboard.press('Escape')),
      log,
    )
    problems.push(...escapeProblems)
    return problems
  })

// BUYING

type BuyRoute = Readonly<{ name: string; before: ReadonlyArray<string> }>

const BUY_ROUTES: ReadonlyArray<BuyRoute> = [
  { name: 'buy', before: [] },
  { name: 'buy-after-coop', before: ['', 'coop=hub'] },
]

const isBuyTap = (tag: string) => String.endsWith('ClickedBuyButton')(tag)

const shopShape = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      // NOTE: runs in the page, which has no effect module.
      // @effect-diagnostics-next-line preferEffectArray:off
      const ids = [...document.querySelectorAll('[id]')].map(
        element => element.id,
      )
      return {
        shops: document.querySelectorAll('dialog#shop').length,
        open: document.querySelectorAll('dialog[open]').length,
        // NOTE: runs in the page, which has no effect module.
        // @effect-diagnostics-next-line preferEffectArray:off
        repeated: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
      }
    }),
  )

const placeBuy = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      const button = document.querySelector(
        'dialog[open] li[data-verdict="available"] button',
      )
      if (button === null) {
        return null
      }
      const box = button.getBoundingClientRect()
      const point = {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      }
      const hit = document.elementFromPoint(point.x, point.y)
      return {
        point,
        isHit: hit !== null && button.contains(hit),
        hit:
          hit === null
            ? 'nothing'
            : // NOTE: runs in the page, which has no effect module.
              // @effect-diagnostics-next-line preferEffectString:off
              `${hit.tagName.toLowerCase()}.${hit.className} in ${hit.closest('dialog')?.id ?? 'no dialog'}`,
      }
    }),
  )

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
    // NOTE: the shop must open as one dialog whose buy buttons take a tap. A
    // shut dialog comes from a cache, and once that cache handed snabbdom a
    // stale shell after co-op opened, so the shop opened as a second
    // `<dialog id="shop">` under an empty one that took every tap. So the
    // shop is opened straight from its query, and again after co-op's
    // screen.
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
