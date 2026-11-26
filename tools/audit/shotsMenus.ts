import { Array, Config, Effect, Option } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import { readLayout } from './inPage/shotsMenus'
import {
  type Log,
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
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
} from './lib'
import { attempt } from './page'

const ALL_VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'd1280', width: 1280, height: 720, scale: 1, isPhone: false },
  { name: 'l852', width: 852, height: 393, scale: 2, isPhone: true },
  { name: 'p393', width: 393, height: 852, scale: 2, isPhone: true },
  { name: 'a360', width: 360, height: 740, scale: 2, isPhone: true },
  { name: 't1024', width: 1024, height: 768, scale: 2, isPhone: true },
]

const FOUND =
  'bests&kills=Shambler:1203,Runner:140,Tank:12,Exploder:9,Thrower:3,Boss:2&opened=Shambler,Tank'
const MANOR = '#home-manor'
const LOOK = 'look=Slim,Ponytail,Red,Tan,Teal,Hoodie,Rainbow,,Glasses'
const PAUSED = 'wave=3&seen=all&start=wave&phase=paused'

type Scene = Readonly<{
  name: string
  query: string
  open?: ReadonlyArray<string>
  isAnimated?: boolean
}>

const SCENES: ReadonlyArray<Scene> = [
  { name: 'home', query: '' },
  { name: 'home-found', query: `${FOUND}&newentries=Thrower&newsseen` },
  { name: 'home-endless', query: `${FOUND}&homemode=endless&newsseen` },
  {
    name: 'home-corner',
    query: `${FOUND}&fit=full&install&newer&newsseen&support`,
  },
  {
    name: 'home-guide',
    query: 'fit=home',
    open: ['#home-install'],
    isAnimated: true,
  },
  { name: 'missions', query: '', open: ['#home-missions'], isAnimated: true },
  { name: 'greet', query: 'greet' },
  { name: 'hand', query: 'support', open: [MANOR], isAnimated: true },
  { name: 'hand-found', query: `${FOUND}&newsseen`, open: [MANOR] },
  {
    name: 'whats-new',
    query: '',
    open: [MANOR, '#hand-card-whatsnew'],
    isAnimated: true,
  },
  {
    name: 'whats-new-older',
    query: '',
    open: [MANOR, '#hand-card-whatsnew', '.news-older'],
    isAnimated: true,
  },
  {
    name: 'howto',
    query: '',
    open: [MANOR, '#hand-card-howtoplay'],
    isAnimated: true,
  },
  {
    name: 'howto-flipped',
    query: '',
    open: [MANOR, '#hand-card-howtoplay', '.help-card >> nth=1'],
    isAnimated: true,
  },
  { name: 'difficulty', query: 'ask', open: ['#home-play'], isAnimated: true },
  {
    name: 'leave',
    query: PAUSED,
    open: ['.pause-menu-button'],
    isAnimated: true,
  },
  { name: 'proof-empty', query: '', open: [MANOR, '#hand-card-proof'] },
  {
    name: 'proof',
    query: 'proof',
    open: [MANOR, '#hand-card-proof'],
    isAnimated: true,
  },
  {
    name: 'proof-picked',
    query: 'proof',
    open: [MANOR, '#hand-card-proof', '#proof-slot-musicbox-hard'],
    isAnimated: true,
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
    isAnimated: true,
  },
  {
    name: 'entry-unlocked',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=0'],
    isAnimated: true,
  },
  {
    name: 'entry-small',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile >> nth=1'],
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
  {
    name: 'munch-shop',
    query: FOUND,
    open: [MANOR, '#hand-card-munchopedia', '.munch-tile-shop'],
    isAnimated: true,
  },
  {
    name: 'munch-shop-section',
    query: FOUND,
    open: [
      MANOR,
      '#hand-card-munchopedia',
      '.munch-tile-shop',
      '.munch-body button >> nth=0',
    ],
  },
  {
    name: 'journal-things',
    query: 'journal&proof',
    open: [MANOR, '#hand-card-munchopedia', '#journal-tab-things'],
  },
  {
    name: 'journal-rooms',
    query: 'journal&proof',
    open: [MANOR, '#hand-card-munchopedia', '#journal-tab-rooms'],
  },
  {
    name: 'journal-story',
    query: 'journal&proof',
    open: [MANOR, '#hand-card-munchopedia', '#journal-tab-story'],
  },
  {
    name: 'journal-story-locked',
    query: 'journal&proof',
    open: [
      MANOR,
      '#hand-card-munchopedia',
      '#journal-tab-story',
      '.journal-page-button >> nth=7',
    ],
  },
  {
    name: 'journal-heroes',
    query: 'journal&proof',
    open: [MANOR, '#hand-card-munchopedia', '#journal-tab-heroes'],
  },
  {
    name: 'proof-journal',
    query: 'journal&proof',
    open: [MANOR, '#hand-card-proof'],
  },
  {
    name: 'proof-all-things',
    query: 'journal&journalall&proof',
    open: [MANOR, '#hand-card-proof'],
  },
  {
    name: 'profile-look',
    query: LOOK,
    open: [MANOR, '#hand-card-character'],
    isAnimated: true,
  },
  { name: 'look-hair', query: `profile=look&looksection=Hair&${LOOK}` },
  { name: 'look-outfit', query: `profile=look&looksection=Outfit&${LOOK}` },
  { name: 'look-gear', query: `profile=look&looksection=Gear&${LOOK}` },
  { name: 'look-rank', query: `profile=look&${LOOK}&rank=1850` },
  { name: 'name-empty', query: 'profile=name' },
  { name: 'name', query: 'profile=name&name=Dr. Chomp&rank=52000' },
  { name: 'account-local', query: 'profile=account' },
  { name: 'account', query: 'profile=account&sync=synced&devices=2' },
  { name: 'account-offline', query: 'profile=account&sync=offline&devices=3' },
  {
    name: 'settings',
    query: 'fit=full&rotate&support',
    open: ['#home-settings'],
    isAnimated: true,
  },
  {
    name: 'settings-reset',
    query: 'profile=settings',
    open: ['#reset-tutorial'],
    isAnimated: true,
  },
  {
    name: 'profile-tab-switch',
    query: 'profile=look',
    open: ['.profile-tab[data-tab="Settings"]'],
    isAnimated: true,
  },
]

const MIN_SIDE = 44
const FRAME_STEPS = 6

const tapAt = (page: Page, viewport: Viewport, selector: string) =>
  Effect.gen(function* () {
    const box = yield* attempt(() =>
      page.locator(selector).first().boundingBox(),
    )
    if (box === null) {
      return false
    }
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    yield* attempt(() =>
      viewport.isPhone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y),
    )
    return true
  })

const stepFrames = (page: Page, name: string) =>
  Effect.gen(function* () {
    for (let step = 0; step <= FRAME_STEPS; step++) {
      yield* attempt(() =>
        page.evaluate(
          ({ share }) => {
            for (const animation of document.getAnimations()) {
              animation.pause()
              const timing = animation.effect?.getComputedTiming()
              const duration = Number(timing?.duration ?? 0)
              const delay = Number(timing?.delay ?? 0)
              animation.currentTime = delay + duration * share
            }
          },
          { share: step / FRAME_STEPS },
        ),
      )
      yield* attempt(() =>
        page.screenshot({
          path: `${import.meta.dir}/shots/${name}-f${step}.png`,
        }),
      )
    }
  })

const checkViewport = (
  pages: ScenePages,
  tag: string,
  viewport: Viewport,
  isFraming: boolean,
  log: Log,
) =>
  Effect.gen(function* () {
    const problems: Array<string> = []
    for (const scene of SCENES) {
      if (!(yield* isPickedScene(scene.name))) {
        continue
      }
      const page = yield* pages.open(
        viewport,
        harnessQuery(scene.query, deviceQuery(viewport)),
      )
      yield* settleAnimations(page)
      const name = `menus-${tag}-${viewport.name}-${scene.name}`
      const openers = scene.open ?? []
      for (let index = 0; index < openers.length; index++) {
        const selector = openers[index] ?? ''
        const isLast = index === openers.length - 1
        if (!(yield* tapAt(page, viewport, selector))) {
          problems.push(`${name}: nothing to open with ${selector}`)
          continue
        }
        if (isLast && isFraming && scene.isAnimated === true) {
          yield* stepFrames(page, name)
        }
        yield* settleAnimations(page)
      }
      const found = yield* attempt(() =>
        page.evaluate(readLayout, {
          minSide: MIN_SIDE,
          isPhone: viewport.isPhone,
        }),
      )
      yield* shot(page, name)
      const notes = Array.filter(
        [
          found.small.length > 0
            ? `small: ${Array.join(found.small, ', ')}`
            : '',
          found.outside.length > 0
            ? `outside: ${Array.join(found.outside, ', ')}`
            : '',
          found.clipped.length > 0
            ? `clipped: ${Array.join(found.clipped, '; ')}`
            : '',
          found.pageScroll > 0 ? `PAGE SCROLLS ${found.pageScroll}px` : '',
        ],
        Boolean,
      )
      log(`${name}  ${Array.join(notes, '  ')}`)
      if (notes.length > 0) {
        problems.push(`${name}: ${Array.join(notes, '  ')}`)
      }
      pages.release(page)
    }
    return problems
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const maybeFrames = yield* Config.String('FRAMES').pipe(Config.option)
    const isFraming = Option.isSome(maybeFrames)
    const viewports = yield* pickViewports(ALL_VIEWPORTS)
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['tick=72'])
    const parallel = yield* parallelFrom('SHOTS_PARALLEL')
    const problems = yield* forEachInOrder(
      viewports,
      parallel,
      (viewport, log) => checkViewport(pages, tag, viewport, isFraming, log),
    )
    yield* pages.close
    yield* finish(Array.flatten(problems), 'The menus are clean.')
  }),
)
