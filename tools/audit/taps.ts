import { Array, Config, Effect, Option } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import { placeTapTarget } from './inPage/taps'
import {
  ANDROID_800,
  type Log,
  PHONE_667,
  PHONE_844,
  type ScenePages,
  UPRIGHT_360,
  UPRIGHT_390,
  UPRIGHT_430,
  type Viewport,
  finish,
  forEachInOrder,
  isPickedScene,
  openBrowser,
  parallelFrom,
  pickViewports,
  scenePages,
  settleAnimations,
  wait,
  waitForDialog,
  waitForLobby,
} from './lib'
import { attempt, failWith } from './page'

const LANDSCAPE: ReadonlyArray<Viewport> = [
  { ...PHONE_667, scale: 2 },
  { ...PHONE_844, scale: 2 },
  { ...ANDROID_800, scale: 2 },
]

const PORTRAIT: ReadonlyArray<Viewport> = [
  { ...UPRIGHT_390, scale: 2 },
  { ...UPRIGHT_430, scale: 2 },
  { ...UPRIGHT_360, scale: 2 },
]

const pickedViewports = Effect.gen(function* () {
  const portrait = yield* Config.String('PORTRAIT').pipe(Config.option)
  return yield* pickViewports(Option.isNone(portrait) ? LANDSCAPE : PORTRAIT)
})

type Scene = Readonly<{
  name: string
  query: string
  open?: ReadonlyArray<string>
  opensDialog?: boolean
  fresh?: boolean
  opensLobby?: boolean
}>

const MANOR = '#home-manor'
const LOBBY_QUERY = 'learned=move,fire&rank=300&calling=Handyman'

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
    open: [MANOR, '#hand-card-whatsnew', '.news-older'],
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
  { name: 'victory', query: `wave=8&phase=escaped&stats&${PAST_GRACE}` },
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

const TAP_LEAVES =
  /(^|:)(Clicked\w*|Submitted\w*|SelectedOption|SelectedTab|RequestedClose|PressedPointer|PressedHoldButton|SucceededCopyLinkCode)$/

const isTapMessage = (tag: string): boolean => TAP_LEAVES.test(tag)

const OPEN_TIMEOUT_MS = 10_000

const tapToOpen = (page: Page, scene: Scene, selector: string) =>
  Effect.gen(function* () {
    const locator = page.locator(selector).first()
    yield* attempt(() =>
      locator.waitFor({ state: 'visible', timeout: OPEN_TIMEOUT_MS }),
    ).pipe(Effect.ignore)
    const box = yield* attempt(() => locator.boundingBox())
    if (box === null) {
      return yield* failWith(`${scene.name}: nothing to open with ${selector}`)
    }
    yield* attempt(() =>
      page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2),
    )
  })

const openScene = (page: Page, scene: Scene) =>
  Effect.gen(function* () {
    if (scene.opensDialog === true) {
      yield* waitForDialog(page)
    }
    yield* settleAnimations(page)
    for (const [step, selector] of (scene.open ?? []).entries()) {
      yield* tapToOpen(page, scene, selector)
      yield* step === 0 && scene.opensLobby === true
        ? waitForLobby(page)
        : waitForDialog(page)
      yield* settleAnimations(page)
    }
  })

const TAP_TARGETS = 'button, a.end-button, a.home-support'

const hasButton = (page: Page, at: number, isInDialog: boolean) =>
  attempt(() =>
    page.waitForFunction(
      ({ index, hasDialog, targets }) => {
        const scope: ParentNode = hasDialog
          ? (document.querySelector('dialog[open]') ?? document)
          : document
        return scope.querySelectorAll(targets)[index] !== undefined
      },
      { index: at, hasDialog: isInDialog, targets: TAP_TARGETS },
      { timeout: OPEN_TIMEOUT_MS },
    ),
  ).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

const visibleTargets = (page: Page) =>
  attempt((): Promise<ReadonlyArray<number>> =>
    page.evaluate(targets => {
      const openDialog = document.querySelector('dialog[open]')
      const scope: ParentNode = openDialog ?? document
      const isVisible = (button: Element) => {
        const box = button.getBoundingClientRect()
        const style = getComputedStyle(button)
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          button.closest('[inert]') === null &&
          button.getAttribute('aria-disabled') !== 'true' &&
          (openDialog !== null || button.closest('dialog') === null)
        )
      }
      const indices: Array<number> = []
      const buttons = scope.querySelectorAll(targets)
      for (let index = 0; index < buttons.length; index++) {
        const button = buttons[index]
        if (button !== undefined && isVisible(button)) {
          indices.push(index)
        }
      }
      return indices
    }, TAP_TARGETS),
  )

const openedScroll = (page: Page) =>
  attempt(() =>
    page.evaluate(() =>
      Math.round(document.querySelector('dialog[open] .panel')?.scrollTop ?? 0),
    ),
  )

const placeTarget = (page: Page, at: number, isInDialog: boolean) =>
  attempt((): Promise<Target> =>
    page.evaluate(placeTapTarget, {
      index: at,
      hasDialog: isInDialog,
      inset: EDGE_INSET,
      targets: TAP_TARGETS,
    }),
  )

const hitsButton = (
  page: Page,
  target: Target,
  point: Point,
  isInDialog: boolean,
) =>
  attempt(() =>
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
    ),
  )

const openFreshScene = (pages: ScenePages, viewport: Viewport, scene: Scene) =>
  Effect.gen(function* () {
    const page = yield* pages.open(viewport, scene.query, {
      fresh: scene.fresh === true,
    })
    yield* openScene(page, scene)
    return page
  })

const openWithButton = (
  pages: ScenePages,
  viewport: Viewport,
  scene: Scene,
  index: number,
  hasDialog: boolean,
) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 2; tries++) {
      const page = yield* openFreshScene(pages, viewport, scene)
      if (yield* hasButton(page, index, hasDialog)) {
        return page
      }
      yield* pages.discard(page)
    }
    return null
  })

const checkScene = (
  pages: ScenePages,
  viewport: Viewport,
  scene: Scene,
  log: Log,
) =>
  Effect.gen(function* () {
    const failures: Array<string> = []
    const page = yield* openFreshScene(pages, viewport, scene)
    const hasDialog =
      (scene.open ?? []).length > 0 || scene.opensDialog === true
    const indices = yield* visibleTargets(page)
    const where = `${viewport.name} ${scene.name}`
    if (indices.length === 0) {
      failures.push(`${where}: no buttons`)
    }
    const openScroll = yield* openedScroll(page)
    if (openScroll > 0) {
      failures.push(
        `${where}: the open panel starts ${openScroll} px down, hiding its top`,
      )
    }
    const targets: Array<Target> = []
    for (const index of indices) {
      const target = yield* placeTarget(page, index, hasDialog)
      targets.push(target)
      if (target.width < MIN_SIDE || target.height < MIN_SIDE) {
        failures.push(
          `${where} "${target.label}": ${Math.round(target.width)}x${Math.round(target.height)} is under ${MIN_SIDE} px`,
        )
      }
      for (const { name, point } of target.points) {
        if (!(yield* hitsButton(page, target, point, hasDialog))) {
          failures.push(`${where} "${target.label}": the ${name} misses it`)
        }
      }
    }
    pages.release(page)
    for (const target of targets) {
      for (const { name } of Array.filter(
        target.points,
        ({ name: pointName }) =>
          pointName === 'center' || pointName === 'corner',
      )) {
        const tapPage = yield* openWithButton(
          pages,
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
        const placed = yield* placeTarget(tapPage, target.index, hasDialog)
        const tapPlace = yield* Effect.fromOption(
          Array.findFirst(placed.points, point => point.name === name),
        ).pipe(
          Effect.mapError(() =>
            failWith(`No ${name} point on "${target.label}"`),
          ),
        )
        const tapPoint = tapPlace.point
        yield* attempt(() =>
          tapPage.evaluate(() => {
            window.__messages.length = 0
          }),
        )
        yield* attempt(() =>
          tapPage
            .context()
            .route('https://x.com/**', route =>
              route.fulfill({ status: 200, body: '' }),
            ),
        )
        yield* attempt(() =>
          tapPage.context().grantPermissions(['clipboard-write']),
        )
        yield* attempt(() =>
          tapPage
            .context()
            .route('https://buy.stripe.com/**', route =>
              route.fulfill({ status: 200, body: '' }),
            ),
        )
        yield* attempt(() => tapPage.touchscreen.tap(tapPoint.x, tapPoint.y))
        yield* wait(AFTER_TAP_MS)
        const tags = yield* attempt(() =>
          tapPage.evaluate(() => [...window.__messages]),
        )
        pages.release(tapPage)
        const tapTags = Array.filter(tags, isTapMessage)
        const reachedSurface = Array.some(tags, tag => surfaceTags.has(tag))
        const isOk = tapTags.length === 1 && !reachedSurface
        log(
          `${isOk ? 'ok  ' : 'FAIL'} ${where} "${target.label}" ${name}: ${Array.join(tapTags, ', ') || '(nothing)'}`,
        )
        if (!isOk) {
          failures.push(
            `${where} "${target.label}" ${name} tap sent ${Array.join(tags, ', ') || 'nothing'}`,
          )
        }
      }
    }
    return failures
  })

runHarnessAudit(
  Effect.gen(function* () {
    const viewports = yield* pickedViewports
    const scenes = yield* Effect.filter(SCENES, scene =>
      isPickedScene(scene.name),
    )
    const parallel = yield* parallelFrom('TAPS_PARALLEL')
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['device=touch', 'nodev'])
    const units = Array.flatMap(viewports, viewport =>
      Array.map(scenes, scene => ({ viewport, scene })),
    )
    const failures = yield* forEachInOrder(
      units,
      parallel,
      ({ viewport, scene }, log) => checkScene(pages, viewport, scene, log),
    )
    yield* pages.close
    yield* finish(
      Array.flatten(failures),
      'Every tap landed on its button and sent one Message.',
    )
  }),
)
