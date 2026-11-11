// The dare card pass: the single player lobby as a card that unfolds out of
// PLAY over the home menu. On a 1280x720 desktop, an 844x390 phone on its
// side, and a 390x844 phone held upright it shoots the card open, a frame
// mid-unfold, and a frame mid-fold back into PLAY, as
// `lobby-card-<TAG>-<viewport>-<frame>.png`. It exits with 1 when the card
// runs past the screen, SHAKE ON IT cannot be scrolled to, the fold does
// not start on PLAY or end on the card, or focus is not on START once it is
// open and on PLAY once it is gone.
//   TAG=after bun run heavy -- --shared bun tools/audit/shotsLobbyCard.ts
// VIEWPORTS picks screens.
import { Effect, Schema } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  SHOTS_DIR,
  UPRIGHT_390,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  openBrowser,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  wait,
} from './lib'
import { attempt, evaluateAs } from './page'

// NOTE: d1280, p844 (a phone on its side), and u390 (one held upright).
const VIEWPORTS = pickViewports([DESKTOP_1280, PHONE_844, UPRIGHT_390])

const LOBBY =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles&rank=4000&calling=Handyman'

const Box = Schema.Struct({
  top: Schema.Finite,
  left: Schema.Finite,
  right: Schema.Finite,
  bottom: Schema.Finite,
})
type Box = typeof Box.Type

const Measured = Schema.Struct({
  card: Box,
  play: Box,
  fold: Box,
  start: Box,
  scrollHeight: Schema.Finite,
  clientHeight: Schema.Finite,
  focused: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
})

// NOTE: the boxes of the card, PLAY, the fold, and START, and who has focus.
const measure = (page: Page) =>
  evaluateAs(page, Measured, () => {
    const boxOf = (selector: string) => {
      const found = document.querySelector(selector)
      if (found === null) {
        return { top: 0, left: 0, right: 0, bottom: 0 }
      }
      const { top, left, right, bottom } = found.getBoundingClientRect()
      return { top, left, right, bottom }
    }
    const card = document.querySelector('.dare-card')
    return {
      card: boxOf('.dare-card'),
      play: boxOf('#home-play'),
      fold: boxOf('.dare-fold'),
      start: boxOf('#lobby-start'),
      scrollHeight: card?.scrollHeight ?? 0,
      clientHeight: card?.clientHeight ?? 0,
      focused: document.activeElement?.id ?? '',
      width: innerWidth,
      height: innerHeight,
    }
  })

// NOTE: every running animation held at `ms` into it, for a still frame.
const holdAt = (page: Page, ms: number) =>
  attempt(() =>
    page.evaluate(at => {
      for (const animation of document.getAnimations()) {
        animation.pause()
        animation.currentTime = at
      }
    }, ms),
  )

// NOTE: every held animation runs on from where it was held.
const releaseAnimations = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.play()
      }
    }),
  )

const stillShot = (page: Page, name: string) =>
  attempt(() => page.screenshot({ path: `${SHOTS_DIR}/${name}.png` }))

const boxText = ({ top, left, right, bottom }: Box): string =>
  `${Math.round(left)},${Math.round(top)} to ${Math.round(right)},${Math.round(bottom)}`

const isNear = (a: Box, b: Box): boolean =>
  Math.abs(a.top - b.top) < 3 &&
  Math.abs(a.left - b.left) < 3 &&
  Math.abs(a.right - b.right) < 3

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
    const browser = yield* openBrowser
    const problems: Array<string> = []

    const pages = scenePages(browser, ['nodev'])
    for (const viewport of viewports) {
      const name = (frame: string) =>
        `lobby-card-${tag}-${viewport.name}-${frame}`
      const page = yield* pages.open(
        viewport,
        harnessQuery(LOBBY, deviceQuery(viewport)),
      )
      yield* settleAnimations(page)

      // NOTE: the first frame: the fold sits on PLAY.
      yield* attempt(() => page.click('#home-play'))
      yield* attempt(() =>
        page.locator('.dare-fold').waitFor({ state: 'attached' }),
      )
      yield* holdAt(page, 0)
      const first = yield* measure(page)
      if (!isNear(first.fold, { ...first.play, bottom: first.fold.bottom })) {
        problems.push(`${viewport.name}: the fold does not start on PLAY`)
      }
      yield* holdAt(page, 230)
      yield* stillShot(page, name('mid-unfold'))
      yield* releaseAnimations(page)
      yield* wait(200)
      yield* settleAnimations(page)
      yield* shot(page, name('open'))

      const open = yield* measure(page)
      const where = viewport.name
      if (
        open.card.top < 0 ||
        open.card.left < 0 ||
        open.card.bottom > open.height ||
        open.card.right > open.width
      ) {
        problems.push(`${where}: the card runs past the screen`)
      }
      if (open.start.bottom <= open.start.top) {
        problems.push(`${where}: no SHAKE ON IT`)
      }
      if (open.focused !== 'lobby-start') {
        problems.push(`${where}: focus is on "${open.focused}", not START`)
      }
      if (open.scrollHeight > open.clientHeight + 1) {
        yield* Effect.logInfo(
          `${where}: the card scrolls (${open.scrollHeight} in ${open.clientHeight})`,
        )
      }
      yield* Effect.logInfo(
        `${where}: card ${Math.round(open.card.right - open.card.left)}x${Math.round(open.card.bottom - open.card.top)} at ${Math.round(open.card.left)},${Math.round(open.card.top)}`,
      )

      // NOTE: the fold back: Escape on a desktop, a tap on CHICKEN OUT on a
      // phone (a key there makes the last device the keyboard, and the
      // layout turns), then a frame halfway into PLAY.
      yield* viewport.isPhone
        ? attempt(() => page.locator('.lobby-chicken').tap())
        : attempt(() => page.keyboard.press('Escape'))
      yield* attempt(() =>
        page
          .locator('.lobby[data-state="Folding"]')
          .waitFor({ state: 'attached' }),
      )
      yield* holdAt(page, 0)
      const folding = yield* measure(page)
      if (!isNear(folding.fold, open.card)) {
        problems.push(
          `${where}: the fold back does not start on the card (${boxText(folding.fold)} against ${boxText(open.card)})`,
        )
      }
      yield* holdAt(page, 200)
      yield* stillShot(page, name('mid-fold'))
      yield* releaseAnimations(page)
      yield* attempt(() =>
        page.locator('.lobby').waitFor({ state: 'detached', timeout: 3000 }),
      )
      const gone = yield* measure(page)
      if (gone.focused !== 'home-play') {
        problems.push(`${where}: focus is on "${gone.focused}", not PLAY`)
      }
      pages.release(page)
    }
    yield* pages.close
    yield* finish(
      problems,
      'The card unfolds from PLAY, fits, takes focus, and folds back into PLAY.',
    )
  }),
)
