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
import { type CDPSession, type Page, webkit } from 'playwright-core'

import { PROFILE_TABS } from '@game/profile'

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
  useHarness,
  wait,
  waitForReady,
} from './lib'

const ROUNDS = Number(process.env['ROUNDS'] ?? 16)
const LIVE = process.env['LIVE']
const IS_WEBKIT = process.env['ENGINE'] === 'webkit'
const VIEWPORTS = pickViewports([
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
  DESKTOP_1280,
])
const TIMEOUT_MS = 1500
const HOLD_MS = 80
// NOTE: how long after the last press landed the next one comes. Most fall
// inside the 160 to 280 ms entrances, the rest after them.
const GAPS_MS = [0, 30, 60, 100, 140, 180, 220, 260, 400]
// NOTE: a resting finger is down long before the press, as a palm is.
const REST_MS = 700

type Point = Readonly<{ x: number; y: number }>

type Hand = {
  readonly page: Page
  readonly viewport: Viewport
  readonly cdp: CDPSession | undefined
  resting: Point | undefined
}

const centerOf = (page: Page, selector: string): Promise<Point | null> =>
  page.evaluate(target => {
    const element = document.querySelector(target)
    if (element === null) {
      return null
    }
    const box = element.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  }, selector)

const RESTING_ID = 1
const PRESSING_ID = 2

// NOTE: Chrome's touch emulation takes every finger still down on a
// touchStart, and the fingers to lift on a touchEnd.
// NOTE: the touch session of a phone in Chrome, which every finger goes
// through.
const cdpOf = (hand: Hand): CDPSession => {
  if (hand.cdp === undefined) {
    throw new Error('Touch needs Chrome on a phone screen')
  }
  return hand.cdp
}

const touch = async (hand: Hand, point: Point) => {
  const cdp = cdpOf(hand)
  const pressing = { ...point, id: PRESSING_ID }
  const resting =
    hand.resting === undefined ? [] : [{ ...hand.resting, id: RESTING_ID }]
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [...resting, pressing],
  })
  await wait(HOLD_MS / 2)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [...resting, { ...pressing, x: point.x + 2, y: point.y + 1 }],
  })
  await wait(HOLD_MS / 2)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ ...pressing, x: point.x + 2, y: point.y + 1 }],
  })
}

const press = async (hand: Hand, point: Point) => {
  const { page, viewport } = hand
  if (viewport.isPhone && IS_WEBKIT) {
    await page.touchscreen.tap(point.x, point.y)
  } else if (viewport.isPhone) {
    await touch(hand, point)
  } else {
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await wait(HOLD_MS / 2)
    await page.mouse.move(point.x + 2, point.y + 1, { steps: 2 })
    await wait(HOLD_MS / 2)
    await page.mouse.up()
  }
}

// NOTE: a finger set down on the corner of the screen, away from every
// control, and left there until the round ends.
const restFinger = async (hand: Hand) => {
  hand.resting = { x: 6, y: hand.viewport.height - 6 }
  await cdpOf(hand).send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...hand.resting, id: RESTING_ID }],
  })
  await wait(REST_MS)
}

const liftRestingFinger = async (hand: Hand) => {
  if (hand.resting !== undefined) {
    await cdpOf(hand).send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    hand.resting = undefined
  }
}

const waitFor = (page: Page, check: string) =>
  page
    .waitForFunction(check, null, { timeout: TIMEOUT_MS, polling: 'raf' })
    .then(() => true)
    .catch(() => false)

const IS_OPEN = `document.querySelector('dialog#profile[open] .menu-close') !== null`
const IS_CLOSED = `document.querySelector('dialog[open]') === null`

type Tally = { tries: number; misses: Array<string> }

// NOTE: the harness logs Messages; a deployed copy does not.
const lastTags = (page: Page): Promise<string> =>
  page.evaluate(() =>
    '__messages' in window ? window.__messages.slice(-8).join(', ') : '(live)',
  )

const messageCount = (page: Page): Promise<number> =>
  page.evaluate(() => ('__messages' in window ? window.__messages.length : 0))

const attempt = async (
  hand: Hand,
  tally: Tally,
  what: string,
  selector: string,
  done: string,
): Promise<boolean> => {
  const point = await centerOf(hand.page, selector)
  tally.tries++
  if (point === null) {
    tally.misses.push(
      `${what}: no ${selector}, last ${await lastTags(hand.page)}`,
    )
    return false
  }
  await press(hand, point)
  const isDone = await waitFor(hand.page, done)
  if (!isDone) {
    tally.misses.push(`${what}: last ${await lastTags(hand.page)}`)
  }
  return isDone
}

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
        `${opened('.menu-close')} && ${opened('#hand-card-whatsnew').replace('!==', '===')}`,
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

const openHome = async (page: Page, viewport: Viewport) => {
  if (LIVE === undefined) {
    await page.goto(harnessUrl('nodev', deviceQuery(viewport)))
    await waitForReady(page)
  } else {
    await page.goto(LIVE)
    await page
      .locator('.home-settings')
      .waitFor({ state: 'visible', timeout: 30_000 })
  }
}

const runRound = async (hand: Hand, tally: Tally, round: number) => {
  const route = ROUTES[round % ROUTES.length]
  if (route === undefined) {
    throw new Error('No Profile routes')
  }
  const isTwoFingers = hand.cdp !== undefined && round % 2 === 1
  const where = `round ${round} ${route.name}${isTwoFingers ? ' (second finger)' : ''}`
  let pressIndex = 0
  const gap = () =>
    wait(GAPS_MS[(round * 5 + pressIndex++) % GAPS_MS.length] ?? 0)
  // NOTE: a little time on the home menu, as a player would take.
  await wait(300)
  if (!(await waitFor(hand.page, IS_CLOSED))) {
    tally.misses.push(`${where}: a dialog was still open`)
    await hand.page.keyboard.press('Escape')
    return
  }
  if (isTwoFingers) {
    await restFinger(hand)
  }
  for (const [selector, done] of route.presses) {
    const isOpened = await attempt(
      hand,
      tally,
      `${where} open ${selector}`,
      selector,
      done,
    )
    if (!isOpened) {
      await liftRestingFinger(hand)
      await hand.page.keyboard.press('Escape')
      return
    }
    await gap()
  }
  const last = PROFILE_TABS[round % PROFILE_TABS.length] ?? 'Look'
  const order = [...PROFILE_TABS.filter(tab => tab !== last), last]
  for (const tab of order) {
    await attempt(
      hand,
      tally,
      `${where} tab ${tab}`,
      tabSelector(tab),
      isSelected(tab),
    )
    await gap()
  }
  const inside = IN_TAB[last] ?? ''
  if (inside !== '') {
    for (let time = 0; time < 2; time++) {
      const before = await messageCount(hand.page)
      await attempt(
        hand,
        tally,
        `${where} in ${last}`,
        inside,
        LIVE === undefined
          ? `(window.__messages?.length ?? 0) > ${before}`
          : 'true',
      )
      await gap()
    }
  }
  await attempt(
    hand,
    tally,
    `${where} close on ${last}`,
    'dialog#profile[open] .menu-close',
    IS_CLOSED,
  )
  await liftRestingFinger(hand)
}

const runScreen = async (viewport: Viewport, log: Log) => {
  const browser = IS_WEBKIT ? await webkit.launch() : await launch()
  const page = await openPage(browser, viewport)
  await openHome(page, viewport)
  const hand: Hand = {
    page,
    viewport,
    cdp:
      viewport.isPhone && !IS_WEBKIT
        ? await page.context().newCDPSession(page)
        : undefined,
    resting: undefined,
  }
  const tally: Tally = { tries: 0, misses: [] }
  for (let round = 0; round < ROUNDS; round++) {
    await runRound(hand, tally, round)
  }
  await browser.close()
  log(
    `${viewport.name}: ${tally.misses.length} of ${tally.tries} presses missed`,
  )
  for (const miss of tally.misses) {
    log(`  ${miss}`)
  }
  return tally.misses.map(miss => `${viewport.name} ${miss}`)
}

await useHarness()
const problems = (
  await forEachInOrder(VIEWPORTS, parallelFrom('PROFILE_PARALLEL'), runScreen)
).flat()
finish(problems, 'Every press in the Profile landed.')
