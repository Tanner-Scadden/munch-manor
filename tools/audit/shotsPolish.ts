// The menus' polish pass: the solo lobby and its hero picker, every co-op
// screen, the end cards, pause and its leave question, the new zombie card,
// the display case card, and the dare card with its satchel, on a 1280x720
// desktop, an 852x393 phone on its side, a 393x852 phone held upright, a
// small 360x740 Android, and a 1024x768 tablet, as
// `polish-<TAG>-<viewport>-<scene>.png`. On each it lists the paper cuts a
// page can find by itself: a touch target under 44 px on a touch screen, a
// button or label whose text is cut off, a button off screen, and a page
// that scrolls. It exits with 1 on any.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsPolish.ts
// ONLY picks scenes, and VIEWPORTS picks screens.
import { Array, Effect, Schema } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Act,
  type Viewport,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  openLobby,
  pickViewports,
  press,
  scenePages,
  settleAnimations,
  shot,
} from './lib'
import { attempt, decodedFrom } from './page'

const ALL_VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'd1280', width: 1280, height: 720, scale: 1, isPhone: false },
  { name: 'l852', width: 852, height: 393, scale: 3, isPhone: true },
  { name: 'p393', width: 393, height: 852, scale: 3, isPhone: true },
  { name: 'a360', width: 360, height: 740, scale: 3, isPhone: true },
  { name: 't1024', width: 1024, height: 768, scale: 2, isPhone: true },
]

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles,displayCase,dareCard'
const LOBBY = `${LEARNED}&rank=4000&calling=Handyman`
const LONG_NAME = 'name=WWWWWWWWWWWW'

type Scene = Readonly<{ name: string; query: string; act?: Act }>

const clickFirst =
  (selector: string): Act =>
  page =>
    Effect.andThen(
      attempt(() => page.locator(selector).first().click()),
      settleAnimations(page),
    )

const lobby =
  (...then: ReadonlyArray<Act>): Act =>
  page =>
    Effect.gen(function* () {
      yield* openLobby(page)
      yield* settleAnimations(page)
      for (const act of then) {
        yield* act(page)
      }
    })

const SCENES: ReadonlyArray<Scene> = [
  { name: 'lobby', query: LOBBY, act: lobby() },
  { name: 'lobby-long', query: `${LOBBY}&${LONG_NAME}`, act: lobby() },
  { name: 'lobby-bots', query: `${LOBBY}&lobbybots=3`, act: lobby() },
  {
    name: 'lobby-heroes',
    query: LOBBY,
    act: lobby(clickFirst('.lobby-hero')),
  },
  ...Array.map(
    [
      'hub',
      'problem',
      'code',
      'asking',
      'queue',
      'offer',
      'accepted',
      'lobby',
      'host',
      'picks',
      'heroes',
      'name',
      'herosale',
      'heroshort',
      'guest',
      'nudge',
      'padlock',
      'ready',
      'result',
      'arena',
      'away',
      'ended',
      'card',
      'cardwon',
      'cardduo',
    ],
    coop => ({
      name: `coop-${coop}`,
      query: `coop=${coop}&${LEARNED}&tick=30`,
    }),
  ),
  {
    name: 'end-over',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=162&rankgain=60&tick=400`,
  },
  {
    name: 'end-best',
    query: `wave=12&mode=endless&phase=gameover&stats&best=9&crowd=10&${LEARNED}&tick=400`,
  },
  {
    name: 'end-escaped',
    query: `wave=10&phase=escaped&stats&difficulty=Hard&${LEARNED}&rank=1900&rankgain=250&tick=400`,
  },
  {
    name: 'end-crew',
    query: `wave=5&phase=gameover&stats&party=4&crowd=10&${LEARNED}&rank=240&rankgain=95&tick=400`,
  },
  { name: 'pause', query: `wave=3&phase=paused&${LEARNED}` },
  {
    name: 'pause-leave',
    query: `wave=3&phase=paused&${LEARNED}`,
    act: press(/^menu: leave/i),
  },
  {
    name: 'newzombie',
    query: `wave=2&start=wave&seen=Shambler&card=1500&${LEARNED}`,
  },
  {
    name: 'casecard',
    query: `learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey&wave=3&break=open&kills=Runner:3&px=40&py=150&tick=40`,
  },
  {
    name: 'pocket',
    query: `learned=move,fire&wave=1&break=open&breakMs=3000&pocket=6000`,
  },
  {
    name: 'dareopen',
    query: `wave=3&start=wave&${LEARNED}&darefound=2&satchel=2&dareopen=2000`,
  },
]

const Found = Schema.Struct({
  small: Schema.Array(Schema.String),
  clipped: Schema.Array(Schema.String),
  offscreen: Schema.Array(Schema.String),
  scrolls: Schema.Boolean,
})

// NOTE: what the page can find wrong with itself: small targets (touch
// only), cut off text, buttons past the screen, and a page that scrolls.
// It runs in the page, which has no effect module, so it keeps to loops
// and the DOM's own reads.
const findCuts = (page: Page, isTouch: boolean) =>
  decodedFrom(Found, () =>
    page.evaluate(isTouchScreen => {
      const label = (element: Element) =>
        `${element.tagName}.${element.classList.item(0) ?? ''} "${element.getAttribute('aria-label') ?? element.textContent}"`
      const isShown = (element: Element) => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.05 &&
          element.closest('[inert]') === null
        )
      }
      const small: Array<string> = []
      const offscreen: Array<string> = []
      for (const button of document.querySelectorAll(
        'button, [role="button"], a[href]',
      )) {
        if (!isShown(button)) {
          continue
        }
        const box = button.getBoundingClientRect()
        // NOTE: a ::before that reaches past the button is its hit area.
        const reach = getComputedStyle(button, '::before')
        const isReaching =
          reach.content !== 'none' && reach.position === 'absolute'
        const width = Math.max(
          box.width,
          isReaching ? Number.parseFloat(reach.width) : 0,
        )
        const height = Math.max(
          box.height,
          isReaching ? Number.parseFloat(reach.height) : 0,
        )
        if (isTouchScreen && (width < 43.5 || height < 43.5)) {
          small.push(
            `${label(button)} ${Math.round(width)}x${Math.round(height)}`,
          )
        }
        if (
          box.left < -1 ||
          box.top < -1 ||
          box.right > innerWidth + 1 ||
          box.bottom > innerHeight + 1
        ) {
          offscreen.push(label(button))
        }
      }
      const clipped: Array<string> = []
      for (const element of document.querySelectorAll('body *')) {
        if (
          element.children.length > 0 ||
          element.textContent === '' ||
          element.closest('.sr-only, canvas, [aria-hidden="true"] svg') !==
            null ||
          element.clientWidth <= 2 ||
          !isShown(element)
        ) {
          continue
        }
        const style = getComputedStyle(element)
        const isClipping =
          style.overflow !== 'visible' || style.textOverflow === 'ellipsis'
        if (isClipping && element.scrollWidth > element.clientWidth + 1) {
          clipped.push(
            `${label(element)} ${element.scrollWidth}>${element.clientWidth}`,
          )
        }
      }
      const scroller = document.scrollingElement
      return {
        small,
        clipped,
        offscreen,
        scrolls:
          scroller !== null &&
          (scroller.scrollHeight > innerHeight + 1 ||
            scroller.scrollWidth > innerWidth + 1),
      }
    }, isTouch),
  )

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* pickViewports(ALL_VIEWPORTS)
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const problems: Array<string> = []
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
          { fresh: scene.act !== undefined },
        )
        yield* settleAnimations(page)
        if (scene.act !== undefined) {
          yield* scene.act(page)
        }
        yield* shot(page, `polish-${tag}-${viewport.name}-${scene.name}`)
        const cuts = yield* findCuts(page, viewport.isPhone)
        const where = `${viewport.name} ${scene.name}`
        for (const small of cuts.small) {
          problems.push(`${where}: small target ${small}`)
        }
        for (const clipped of cuts.clipped) {
          problems.push(`${where}: clipped ${clipped}`)
        }
        for (const off of cuts.offscreen) {
          problems.push(`${where}: off screen ${off}`)
        }
        if (cuts.scrolls) {
          problems.push(`${where}: the page scrolls`)
        }
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'No paper cuts found.')
  }),
)
