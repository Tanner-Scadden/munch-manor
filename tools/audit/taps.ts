// Taps every visible button on the home menu (with the full screen icon, the
// update chip, and a NEW ENTRY pop too), the MANOR hand, What's New, the Munchopedia list and
// an entry, the difficulty picker, its other panels, the pause screen,
// the Profile's tabs, the leave question, the gun cluster in a wave and a
// break, the hold-to-buy button at the kitchen's boards in both, the shop (its cards, tabs, and the close X), Game Over, and Victory on
// 667x375 and 844x390 phones, or with PORTRAIT=1 on 390x844, 430x932, and
// 360x800 phones held upright, with touch. For each button it checks that the center and four points just
// inside its edges hit that button (document.elementFromPoint), then taps the
// center and a corner for real and checks that exactly one Message names the
// tap, and that it is not a press on the game surface. Exits with 1 on any
// miss.
//   bun taps.ts
//   PORTRAIT=1 bun taps.ts
// VIEWPORTS picks phones by name, such as `VIEWPORTS=u390,u360`.
// ONLY picks scenes, such as `ONLY=home,munchopedia`.
// TAPS_PARALLEL sets how many scenes run at once, each in its own browser
// context (3 by default, 1 for one after another). The report keeps the
// order of a run one after another.
import type { Page } from 'playwright-core'

import {
  type Log,
  PHONE_667,
  PHONE_844,
  UPRIGHT_360,
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
  useHarness,
  wait,
  waitForDialog,
  waitForLobby,
} from './lib'

// NOTE: a 2x pixel ratio on every phone keeps the many reloads quick. The hit
// tests read CSS pixels, so the ratio does not change them.
const LANDSCAPE: ReadonlyArray<Viewport> = [
  { ...PHONE_667, scale: 2 },
  { ...PHONE_844, scale: 2 },
]

const PORTRAIT: ReadonlyArray<Viewport> = [
  { ...UPRIGHT_390, scale: 2 },
  { ...UPRIGHT_430, scale: 2 },
  { ...UPRIGHT_360, scale: 2 },
]

const VIEWPORTS = pickViewports(
  process.env['PORTRAIT'] === undefined ? LANDSCAPE : PORTRAIT,
)

type Scene = Readonly<{
  name: string
  query: string
  open?: ReadonlyArray<string>
  opensDialog?: boolean
  fresh?: boolean
  // NOTE: the first open step is PLAY, which opens the single player lobby
  // (a screen, not a dialog), for a player who has learned to move and fire.
  opensLobby?: boolean
}>

const MANOR = '#home-manor'
const LOBBY_QUERY = 'learned=move,fire&rank=300&calling=Handyman'

// NOTE: the end screens show their buttons only once the restart grace
// (RESTART_GRACE_MS, 900 ms) is over, and those buttons come before the
// corner's Music and Mute in the page. On real frames a scene could be
// measured inside the grace and tapped after it, so a button's index named
// another button. 72 fixed frames (1.2 s), played at once and held, open
// every end scene past the grace with all its buttons, on every run.
const PAST_GRACE = 'tick=72'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  {
    name: 'home-full',
    query: 'fit=full&kills=Runner:3&newentries=Runner',
  },
  { name: 'home-iphone', query: 'fit=home', fresh: true },
  { name: 'home-update', query: 'fit=full&install&newer' },
  { name: 'home-guide', query: 'fit=home', open: ['#home-install'] },
  { name: 'greet', query: 'greet', opensDialog: true },
  { name: 'hand', query: 'support', open: [MANOR] },
  { name: 'whats-new', query: '', open: [MANOR, '#hand-card-whatsnew'] },
  {
    name: 'whats-new-older',
    query: '',
    open: [MANOR, '#hand-card-whatsnew', '.news-page'],
  },
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
  { name: 'difficulty', query: 'ask', open: ['#home-play'] },
  {
    name: 'lobby',
    query: LOBBY_QUERY,
    open: ['#home-play'],
    opensLobby: true,
  },
  {
    name: 'lobby-nightmare',
    query: `${LOBBY_QUERY}&difficulty=Hard&nightmare=Unlocked`,
    open: ['#home-play'],
    opensLobby: true,
  },
  {
    name: 'lobby-hero',
    query: LOBBY_QUERY,
    open: ['#home-play', '#lobby-hero'],
    opensLobby: true,
  },
  { name: 'how-to-play', query: '', open: [MANOR, '#hand-card-howtoplay'] },
  {
    name: 'profile-settings',
    query: 'fit=full&rotate',
    open: ['#home-settings'],
  },
  { name: 'profile-look', query: '', open: [MANOR, '#hand-card-character'] },
  {
    name: 'profile-name',
    query: 'name=Snackula',
    open: ['#home-settings', '.profile-tab[data-tab="Name"]'],
  },
  {
    name: 'profile-account',
    query: 'sync=synced&devices=2',
    open: ['#home-settings', '.profile-tab[data-tab="Account"]'],
  },
  {
    name: 'profile-showing',
    query: 'sync=synced&link=showing',
    open: ['#home-settings', '.profile-tab[data-tab="Account"]'],
  },
  {
    name: 'profile-entering',
    query: 'sync=synced&link=entering',
    open: ['#home-settings', '.profile-tab[data-tab="Account"]'],
  },
  { name: 'paused', query: 'wave=3&seen=all&start=wave&phase=paused' },
  {
    name: 'leave',
    query: 'wave=3&seen=all&start=wave&phase=paused',
    open: ['.pause-menu-button'],
  },
  {
    name: 'wave-lowammo',
    query: 'wave=3&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9',
  },
  {
    name: 'break-lowammo',
    query: 'wave=3&seen=all&gun=smg&loaded=9&barricades=1&turrets=1',
  },
  {
    name: 'boards',
    query:
      'wave=3&seen=all&gun=smg&money=85&barricades=1&turrets=1&px=70&py=27',
  },
  {
    name: 'boards-wave',
    query:
      'wave=4&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9&money=85&px=70&py=27',
  },
  {
    name: 'stall-wave',
    query:
      'wave=4&seen=all&start=wave&gun=smg&elapsed=6000&loaded=9&money=85&px=240&py=146',
  },
  {
    name: 'knife-wave',
    query: 'wave=4&seen=all&start=wave&gun=smg&elapsed=6000&loaded=30&knife',
  },
  {
    name: 'shop',
    query: 'wave=5&money=180&gun=smg&tier=1&px=270&py=142',
    opensDialog: true,
  },
  {
    name: 'shop-broke',
    query: 'wave=3&money=12&gun=shotgun&px=270&py=142',
    opensDialog: true,
  },
  { name: 'gameover', query: `wave=4&phase=gameover&stats&${PAST_GRACE}` },
  { name: 'victory', query: `wave=8&phase=victory&stats&${PAST_GRACE}` },
]

type Point = Readonly<{ x: number; y: number }>
type Target = Readonly<{
  label: string
  index: number
  center: Point
  points: ReadonlyArray<Readonly<{ name: string; point: Point }>>
  width: number
  height: number
}>

const EDGE_INSET = 2
const MIN_SIDE = 48
const AFTER_TAP_MS = 250

const surfaceTags = new Set(['PressedPointer'])

// NOTE: a form's submit button names its tap with a Submitted Message, and
// the hold-to-buy button its press with PressedHoldButton.
const TAP_LEAVES =
  /(^|:)(Clicked\w*|Submitted\w*|SelectedOption|SelectedTab|RequestedClose|PressedPointer|PressedHoldButton)$/

const isTapMessage = (tag: string): boolean => TAP_LEAVES.test(tag)

const OPEN_TIMEOUT_MS = 10_000

// NOTE: the fixed waits are the least a scene needs. Each step also waits
// for what it opens, so a busy machine, or several scenes at once, slows
// the run instead of breaking it.
const tapToOpen = async (page: Page, scene: Scene, selector: string) => {
  const locator = page.locator(selector).first()
  await locator
    .waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS })
    .catch(() => undefined)
  const box = await locator.boundingBox()
  if (box === null) {
    throw new Error(`${scene.name}: nothing to open with ${selector}`)
  }
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
}

const openScene = async (page: Page, scene: Scene) => {
  if (scene.opensDialog === true) {
    await waitForDialog(page)
  }
  await settleAnimations(page)
  for (const [step, selector] of (scene.open ?? []).entries()) {
    await tapToOpen(page, scene, selector)
    await (step === 0 && scene.opensLobby === true
      ? waitForLobby(page)
      : waitForDialog(page))
    await settleAnimations(page)
  }
}

// NOTE: what a tap can land on: every button, the end screens' SHARE, a
// link so the browser opens X on the tap itself, and the home menu's coffee,
// a link to the tip jar.
const TAP_TARGETS = 'button, a.end-button, a.home-support'

// NOTE: true once the scene shows a button at `index`, in the open dialog
// when there is one.
const hasButton = (page: Page, at: number, isInDialog: boolean) =>
  page
    .waitForFunction(
      ({ index, hasDialog, targets }) => {
        const scope: ParentNode = hasDialog
          ? (document.querySelector('dialog[open]') ?? document)
          : document
        return scope.querySelectorAll(targets)[index] !== undefined
      },
      { index: at, hasDialog: isInDialog, targets: TAP_TARGETS },
      { timeout: OPEN_TIMEOUT_MS },
    )
    .then(() => true)
    .catch(() => false)

const visibleTargets = (page: Page): Promise<ReadonlyArray<number>> =>
  page.evaluate(targets => {
    const openDialog = document.querySelector('dialog[open]')
    const scope: ParentNode = openDialog ?? document
    return Array.from(scope.querySelectorAll(targets))
      .map((button, index) => ({ button, index }))
      .filter(({ button }) => {
        const box = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          (openDialog !== null || button.closest('dialog') === null)
        )
      })
      .map(({ index }) => index)
  }, TAP_TARGETS)

// NOTE: only a dialog's own panel counts. A list inside it, such as the
// Munchopedia's tiles, may keep its place.
const openedScroll = (page: Page): Promise<number> =>
  page.evaluate(() =>
    Math.round(document.querySelector('dialog[open] .panel')?.scrollTop ?? 0),
  )

// NOTE: a panel that scrolls, such as Settings on a landscape phone, can
// open with some buttons out of view. A player scrolls to them, so each
// button is scrolled into view before it is measured, hit tested, and tapped.
const placeTarget = (
  page: Page,
  at: number,
  isInDialog: boolean,
): Promise<Target> =>
  page.evaluate(
    ({ index, hasDialog, inset, targets }) => {
      const scope: ParentNode = hasDialog
        ? (document.querySelector('dialog[open]') ?? document)
        : document
      const button = scope.querySelectorAll(targets)[index]
      if (button === undefined) {
        throw new Error(`No tap target at ${index}`)
      }
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const box = button.getBoundingClientRect()
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      return {
        label: button.getAttribute('aria-label') ?? button.textContent.trim(),
        index,
        center,
        width: box.width,
        height: box.height,
        points: [
          { name: 'center', point: center },
          { name: 'left', point: { x: box.left + inset, y: center.y } },
          { name: 'right', point: { x: box.right - inset, y: center.y } },
          { name: 'top', point: { x: center.x, y: box.top + inset } },
          { name: 'bottom', point: { x: center.x, y: box.bottom - inset } },
          {
            name: 'corner',
            point: { x: box.left + inset * 4, y: box.top + inset * 4 },
          },
        ],
      }
    },
    {
      index: at,
      hasDialog: isInDialog,
      inset: EDGE_INSET,
      targets: TAP_TARGETS,
    },
  )

const hitsButton = (
  page: Page,
  target: Target,
  point: Point,
  isInDialog: boolean,
) =>
  page.evaluate(
    ({ index, point: { x, y }, hasDialog, targets }) => {
      const scope: ParentNode = hasDialog
        ? (document.querySelector('dialog[open]') ?? document)
        : document
      const button = scope.querySelectorAll(targets)[index]
      const hit = document.elementFromPoint(x, y)
      return button !== undefined && hit !== null && button.contains(hit)
    },
    {
      index: target.index,
      point,
      hasDialog: isInDialog,
      targets: TAP_TARGETS,
    },
  )

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['device=touch', 'nodev'])

// NOTE: a tap can change the scene, so every tap gets the scene again. It is
// switched in on a page of the same screen, which starts from the query with
// an empty save, whatever earlier taps wrote to storage. A scene marked
// `fresh`, such as the iPhone tip, gets a new browser context instead, with
// empty storage, as a first visit would.
const openFreshScene = async (viewport: Viewport, scene: Scene) => {
  const page = await pages.open(viewport, scene.query, {
    fresh: scene.fresh === true,
  })
  await openScene(page, scene)
  return page
}

// NOTE: opens the scene fresh for one tap, once more if the button is not
// there yet, and gives null when it is still missing.
const openWithButton = async (
  viewport: Viewport,
  scene: Scene,
  index: number,
  hasDialog: boolean,
): Promise<Page | null> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const page = await openFreshScene(viewport, scene)
    if (await hasButton(page, index, hasDialog)) {
      return page
    }
    await pages.discard(page)
  }
  return null
}

const checkScene = async (
  viewport: Viewport,
  scene: Scene,
  log: Log,
): Promise<ReadonlyArray<string>> => {
  const failures: Array<string> = []
  const page = await openFreshScene(viewport, scene)
  const hasDialog = (scene.open ?? []).length > 0 || scene.opensDialog === true
  const indices = await visibleTargets(page)
  const where = `${viewport.name} ${scene.name}`
  if (indices.length === 0) {
    failures.push(`${where}: no buttons`)
  }
  const openScroll = await openedScroll(page)
  if (openScroll > 0) {
    failures.push(
      `${where}: the open panel starts ${openScroll} px down, hiding its top`,
    )
  }
  const targets: Array<Target> = []
  for (const index of indices) {
    const target = await placeTarget(page, index, hasDialog)
    targets.push(target)
    if (target.width < MIN_SIDE || target.height < MIN_SIDE) {
      failures.push(
        `${where} "${target.label}": ${Math.round(target.width)}x${Math.round(target.height)} is under ${MIN_SIDE} px`,
      )
    }
    for (const { name, point } of target.points) {
      if (!(await hitsButton(page, target, point, hasDialog))) {
        failures.push(`${where} "${target.label}": the ${name} misses it`)
      }
    }
  }
  pages.release(page)
  for (const target of targets) {
    for (const { name } of target.points.filter(
      ({ name: pointName }) => pointName === 'center' || pointName === 'corner',
    )) {
      const tapPage = await openWithButton(
        viewport,
        scene,
        target.index,
        hasDialog,
      )
      if (tapPage === null) {
        log(`FAIL ${where} "${target.label}" ${name}: gone on reopen`)
        failures.push(
          `${where} "${target.label}" ${name}: the button was not there when the scene was opened again`,
        )
        continue
      }
      const tapPlace = (
        await placeTarget(tapPage, target.index, hasDialog)
      ).points.find(placed => placed.name === name)
      if (tapPlace === undefined) {
        throw new Error(`No ${name} point on "${target.label}"`)
      }
      const tapPoint = tapPlace.point
      await tapPage.evaluate(() => {
        window.__messages.length = 0
      })
      // NOTE: the end screens' SHARE is a link that opens X in a new tab,
      // and the coffee one that opens the tip jar; x.com and Stripe are
      // answered here, so a tap never reaches either.
      await tapPage
        .context()
        .route('https://x.com/**', route =>
          route.fulfill({ status: 200, body: '' }),
        )
      await tapPage
        .context()
        .route('https://buy.stripe.com/**', route =>
          route.fulfill({ status: 200, body: '' }),
        )
      await tapPage.touchscreen.tap(tapPoint.x, tapPoint.y)
      await wait(AFTER_TAP_MS)
      const tags = await tapPage.evaluate(() => [...window.__messages])
      pages.release(tapPage)
      const tapTags = tags.filter(isTapMessage)
      const reachedSurface = tags.some(tag => surfaceTags.has(tag))
      const isOk = tapTags.length === 1 && !reachedSurface
      log(
        `${isOk ? 'ok  ' : 'FAIL'} ${where} "${target.label}" ${name}: ${tapTags.join(', ') || '(nothing)'}`,
      )
      if (!isOk) {
        failures.push(
          `${where} "${target.label}" ${name} tap sent ${tags.join(', ') || 'nothing'}`,
        )
      }
    }
  }
  return failures
}

// NOTE: each viewport and scene pair is one unit of work, so even the two
// landscape phones fill every context.
const UNITS = VIEWPORTS.flatMap(viewport =>
  SCENES.filter(scene => isPickedScene(scene.name)).map(scene => ({
    viewport,
    scene,
  })),
)

const failures = await forEachInOrder(
  UNITS,
  parallelFrom('TAPS_PARALLEL'),
  ({ viewport, scene }, log) => checkScene(viewport, scene, log),
)
await pages.close()
await browser.close()

finish(failures.flat(), 'Every tap landed on its button and sent one Message.')
