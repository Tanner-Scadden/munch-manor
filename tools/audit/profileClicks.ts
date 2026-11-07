// The Profile press pass. ROUNDS times per screen it opens the Profile (the
// gear, the character on the stage, the MORE hand's Character card, or the
// gear after What's New, in turn), taps every tab, presses a button inside
// the last one twice, and closes it with its X. All at real timing: no
// animation is frozen or skipped, each press comes 0 to 400 ms after the
// last one landed (so many land while a dialog pops in, a page turns, or
// the hand's cards are dealt), and each is held down as a finger or a mouse
// button is. Touch on phones, a mouse on a desktop, landscape and portrait.
// On a phone every other round keeps another finger resting on the glass,
// as a thumb or a palm does, and makes every press with a second finger.
// Every press must land: an open opens, a tab selects itself, a button
// inside sends its Message, and the X closes the dialog. Exits with 1 on
// any miss.
//   bun run heavy -- --shared bun tools/audit/profileClicks.ts
// ROUNDS sets the rounds (16 by default), VIEWPORTS picks screens,
// PROFILE_PARALLEL how many screens run at once (3 by default),
// `ENGINE=webkit` runs WebKit (one finger only), and `LIVE=<url>` runs it
// against a deployed copy instead of the harness.
import { Array, Config, Effect, Option, String } from 'effect'
import { type CDPSession, type Page, webkit } from 'playwright-core'

import { PROFILE_TABS } from '@game/profile'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  type Log,
  PHONE_844,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  forEachInOrder,
  harnessUrl,
  launch,
  openPage,
  parallelFrom,
  pickViewports,
  sceneReady,
  wait,
} from './lib'
import { attempt, failWith } from './page'

const VIEWPORTS = [
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
  DESKTOP_1280,
]
const TIMEOUT_MS = 1500
const HOLD_MS = 80
// NOTE: how long after the last press landed the next one comes. Most fall
// inside the 160 to 280 ms entrances, the rest after them.
const GAPS_MS = [0, 30, 60, 100, 140, 180, 220, 260, 400]
// NOTE: a resting finger is down long before the press, as a palm is.
const REST_MS = 700

// NOTE: what the environment asks for: ROUNDS, LIVE, and ENGINE.
type Settings = Readonly<{
  rounds: number
  live: Option.Option<string>
  isWebkit: boolean
}>

const settingsFromEnv = Effect.gen(function* () {
  const rounds = yield* Config.String('ROUNDS').pipe(Config.withDefault('16'))
  const live = yield* Config.String('LIVE').pipe(Config.option)
  const engine = yield* Config.String('ENGINE').pipe(Config.withDefault(''))
  return { rounds: Number(rounds), live, isWebkit: engine === 'webkit' }
})

type Point = Readonly<{ x: number; y: number }>

type Hand = {
  readonly page: Page
  readonly viewport: Viewport
  readonly cdp: CDPSession | undefined
  readonly isWebkit: boolean
  resting: Point | undefined
}

const centerOf = (page: Page, selector: string) =>
  attempt((): Promise<Point | null> =>
    page.evaluate(target => {
      const element = document.querySelector(target)
      if (element === null) {
        return null
      }
      const box = element.getBoundingClientRect()
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }, selector),
  )

const RESTING_ID = 1
const PRESSING_ID = 2

// NOTE: Chrome's touch emulation takes every finger still down on a
// touchStart, and the fingers to lift on a touchEnd.
// NOTE: the touch session of a phone in Chrome, which every finger goes
// through.
const cdpOf = (hand: Hand) =>
  hand.cdp === undefined
    ? Effect.fail(failWith('Touch needs Chrome on a phone screen'))
    : Effect.succeed(hand.cdp)

const touch = (hand: Hand, point: Point) =>
  Effect.gen(function* () {
    const cdp = yield* cdpOf(hand)
    const pressing = { ...point, id: PRESSING_ID }
    const resting =
      hand.resting === undefined ? [] : [{ ...hand.resting, id: RESTING_ID }]
    yield* attempt(() =>
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [...resting, pressing],
      }),
    )
    yield* wait(HOLD_MS / 2)
    yield* attempt(() =>
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          ...resting,
          { ...pressing, x: point.x + 2, y: point.y + 1 },
        ],
      }),
    )
    yield* wait(HOLD_MS / 2)
    yield* attempt(() =>
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [{ ...pressing, x: point.x + 2, y: point.y + 1 }],
      }),
    )
  })

const click = (page: Page, point: Point) =>
  Effect.gen(function* () {
    yield* attempt(() => page.mouse.move(point.x, point.y))
    yield* attempt(() => page.mouse.down())
    yield* wait(HOLD_MS / 2)
    yield* attempt(() =>
      page.mouse.move(point.x + 2, point.y + 1, { steps: 2 }),
    )
    yield* wait(HOLD_MS / 2)
    yield* attempt(() => page.mouse.up())
  })

const press = (hand: Hand, point: Point) => {
  const { page, viewport } = hand
  if (viewport.isPhone && hand.isWebkit) {
    return attempt(() => page.touchscreen.tap(point.x, point.y))
  }
  return viewport.isPhone ? touch(hand, point) : click(page, point)
}

// NOTE: a finger set down on the corner of the screen, away from every
// control, and left there until the round ends.
const restFinger = (hand: Hand) =>
  Effect.gen(function* () {
    const resting = { x: 6, y: hand.viewport.height - 6 }
    hand.resting = resting
    const cdp = yield* cdpOf(hand)
    yield* attempt(() =>
      cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...resting, id: RESTING_ID }],
      }),
    )
    yield* wait(REST_MS)
  })

const liftRestingFinger = (hand: Hand) =>
  Effect.gen(function* () {
    if (hand.resting !== undefined) {
      const cdp = yield* cdpOf(hand)
      yield* attempt(() =>
        cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        }),
      )
      hand.resting = undefined
    }
  })

const waitFor = (page: Page, check: string) =>
  attempt(() =>
    page.waitForFunction(check, null, { timeout: TIMEOUT_MS, polling: 'raf' }),
  ).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )

const IS_OPEN = `document.querySelector('dialog#profile[open] .menu-close') !== null`
const IS_CLOSED = `document.querySelector('dialog[open]') === null`

type Tally = { tries: number; misses: Array<string> }

// NOTE: the harness logs Messages; a deployed copy does not.
const lastTags = (page: Page) =>
  attempt(() =>
    page.evaluate(() =>
      '__messages' in window
        ? // NOTE: runs in the page, which has no effect module.
          // @effect-diagnostics-next-line preferEffectArray:off
          window.__messages.slice(-8).join(', ')
        : '(live)',
    ),
  )

const messageCount = (page: Page) =>
  attempt(() =>
    page.evaluate(() =>
      '__messages' in window ? window.__messages.length : 0,
    ),
  )

const tryPress = (
  hand: Hand,
  tally: Tally,
  what: string,
  selector: string,
  done: string,
) =>
  Effect.gen(function* () {
    const point = yield* centerOf(hand.page, selector)
    tally.tries++
    if (point === null) {
      const tags = yield* lastTags(hand.page)
      tally.misses.push(`${what}: no ${selector}, last ${tags}`)
      return false
    }
    yield* press(hand, point)
    const isDone = yield* waitFor(hand.page, done)
    if (!isDone) {
      const tags = yield* lastTags(hand.page)
      tally.misses.push(`${what}: last ${tags}`)
    }
    return isDone
  })

type Route = Readonly<{
  name: string
  presses: ReadonlyArray<readonly [string, string]>
}>

const opened = (selector: string) =>
  `document.querySelector('dialog[open] ${selector}') !== null`

const ROUTES: ReadonlyArray<Route> = [
  { name: 'gear', presses: [['.home-settings', IS_OPEN]] },
  { name: 'hero', presses: [['.home-hero', IS_OPEN]] },
  {
    name: 'hand',
    presses: [
      ['#home-manor', opened('#hand-card-character')],
      ['dialog[open] #hand-card-character', IS_OPEN],
    ],
  },
  {
    name: 'after-news',
    presses: [
      ['#home-manor', opened('#hand-card-whatsnew')],
      [
        'dialog[open] #hand-card-whatsnew',
        `${opened('.menu-close')} && ${String.replace('!==', '===')(opened('#hand-card-whatsnew'))}`,
      ],
      ['dialog[open] .menu-close', IS_CLOSED],
      ['.home-settings', IS_OPEN],
    ],
  },
]

// NOTE: a button inside a tab that only changes the look, the name, or a
// setting, pressed twice. Account's buttons start linking, so it has none.
const IN_TAB: Readonly<Record<string, string>> = {
  Look: 'dialog#profile[open] .look-section[aria-checked="false"]',
  Name: 'dialog#profile[open] .name-dice',
  Account: '',
  Settings: 'dialog#profile[open] .setting-tile',
}

const tabSelector = (tab: string) =>
  `dialog#profile[open] [role="tab"][data-tab="${tab}"]`

const isSelected = (tab: string) =>
  `document.querySelector('${tabSelector(tab)}')?.getAttribute('aria-selected') === 'true'`

const openHome = (settings: Settings, page: Page, viewport: Viewport) =>
  Option.match(settings.live, {
    onNone: () =>
      Effect.andThen(
        attempt(() => page.goto(harnessUrl('nodev', deviceQuery(viewport)))),
        sceneReady(page),
      ),
    onSome: live =>
      Effect.andThen(
        attempt(() => page.goto(live)),
        attempt(() =>
          page
            .locator('.home-settings')
            .waitFor({ state: 'visible', timeout: 30_000 }),
        ),
      ),
  })

const runRound = (
  settings: Settings,
  hand: Hand,
  tally: Tally,
  round: number,
) =>
  Effect.gen(function* () {
    const route = ROUTES[round % ROUTES.length]
    if (route === undefined) {
      return yield* failWith('No Profile routes')
    }
    const isTwoFingers = hand.cdp !== undefined && round % 2 === 1
    const where = `round ${round} ${route.name}${isTwoFingers ? ' (second finger)' : ''}`
    let pressIndex = 0
    const gap = () =>
      wait(GAPS_MS[(round * 5 + pressIndex++) % GAPS_MS.length] ?? 0)
    // NOTE: a little time on the home menu, as a player would take.
    yield* wait(300)
    const isHomeClear = yield* waitFor(hand.page, IS_CLOSED)
    if (!isHomeClear) {
      tally.misses.push(`${where}: a dialog was still open`)
      yield* attempt(() => hand.page.keyboard.press('Escape'))
      return
    }
    if (isTwoFingers) {
      yield* restFinger(hand)
    }
    for (const [selector, done] of route.presses) {
      const isOpened = yield* tryPress(
        hand,
        tally,
        `${where} open ${selector}`,
        selector,
        done,
      )
      if (!isOpened) {
        yield* liftRestingFinger(hand)
        yield* attempt(() => hand.page.keyboard.press('Escape'))
        return
      }
      yield* gap()
    }
    const last = PROFILE_TABS[round % PROFILE_TABS.length] ?? 'Look'
    const order = [...Array.filter(PROFILE_TABS, tab => tab !== last), last]
    for (const tab of order) {
      yield* tryPress(
        hand,
        tally,
        `${where} tab ${tab}`,
        tabSelector(tab),
        isSelected(tab),
      )
      yield* gap()
    }
    const inside = IN_TAB[last] ?? ''
    if (inside !== '') {
      for (let time = 0; time < 2; time++) {
        const before = yield* messageCount(hand.page)
        yield* tryPress(
          hand,
          tally,
          `${where} in ${last}`,
          inside,
          Option.isNone(settings.live)
            ? `(window.__messages?.length ?? 0) > ${before}`
            : 'true',
        )
        yield* gap()
      }
    }
    yield* tryPress(
      hand,
      tally,
      `${where} close on ${last}`,
      'dialog#profile[open] .menu-close',
      IS_CLOSED,
    )
    yield* liftRestingFinger(hand)
  })

const runScreen = (settings: Settings, viewport: Viewport, log: Log) =>
  Effect.gen(function* () {
    const tally: Tally = { tries: 0, misses: [] }
    yield* Effect.scoped(
      Effect.gen(function* () {
        const browser = yield* Effect.acquireRelease(
          attempt(() => (settings.isWebkit ? webkit.launch() : launch())),
          launched => attempt(() => launched.close()).pipe(Effect.ignore),
        )
        const page = yield* openPage(browser, viewport)
        yield* openHome(settings, page, viewport)
        const cdp =
          viewport.isPhone && !settings.isWebkit
            ? yield* attempt(() => page.context().newCDPSession(page))
            : undefined
        const hand: Hand = {
          page,
          viewport,
          cdp,
          isWebkit: settings.isWebkit,
          resting: undefined,
        }
        for (let round = 0; round < settings.rounds; round++) {
          yield* runRound(settings, hand, tally, round)
        }
      }),
    )
    log(
      `${viewport.name}: ${tally.misses.length} of ${tally.tries} presses missed`,
    )
    for (const miss of tally.misses) {
      log(`  ${miss}`)
    }
    return Array.map(tally.misses, miss => `${viewport.name} ${miss}`)
  })

runHarnessAudit(
  Effect.gen(function* () {
    const settings = yield* settingsFromEnv
    const viewports = yield* pickViewports(VIEWPORTS)
    const parallel = yield* parallelFrom('PROFILE_PARALLEL')
    const problems = yield* forEachInOrder(
      viewports,
      parallel,
      (viewport, log) => runScreen(settings, viewport, log),
    )
    yield* finish(Array.flatten(problems), 'Every press in the Profile landed.')
  }),
)
