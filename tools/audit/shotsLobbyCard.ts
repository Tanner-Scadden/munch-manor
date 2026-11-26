import { Config, Effect, Option, Record, Schema, String } from 'effect'
import type { Page } from 'playwright-core'

import { CALLING_NAMES } from '@game/world/names'

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
import { attempt, decodedFrom, evaluateAs } from './page'

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

const holdAt = (page: Page, ms: number) =>
  attempt(() =>
    page.evaluate(at => {
      for (const animation of document.getAnimations()) {
        animation.pause()
        animation.currentTime = at
      }
    }, ms),
  )

const releaseAnimations = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        animation.play()
      }
    }),
  )

const lastEndMs = (page: Page) =>
  evaluateAs(page, Schema.Finite, () => {
    let last = 0
    for (const animation of document.getAnimations()) {
      const effect = animation.effect
      const endMs = Number(effect?.getComputedTiming().endTime ?? 0)
      if (
        effect instanceof KeyframeEffect &&
        effect.target?.closest('.lobby-layer') !== null &&
        Number.isFinite(endMs)
      ) {
        last = Math.max(last, endMs)
      }
    }
    return last
  })

const stillCopy = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      const layer = document.querySelector('.lobby-layer')
      if (layer instanceof HTMLElement) {
        const copy = layer.cloneNode(true)
        if (copy instanceof HTMLElement) {
          copy.dataset['still'] = 'Copy'
          layer.after(copy)
          layer.style.visibility = 'hidden'
        }
      }
    }),
  )

const dropStillCopy = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      document.querySelector('[data-still="Copy"]')?.remove()
    }),
  )

const FRAME_MS = 40

const film = (page: Page, name: (frame: string) => string, way: string) =>
  Effect.gen(function* () {
    const endMs = yield* lastEndMs(page)
    for (let ms = 0; ms <= endMs + FRAME_MS - 1; ms += FRAME_MS) {
      const at = Math.min(ms, endMs)
      yield* holdAt(page, at)
      yield* stillShot(page, name(`${way}-${String.padStart(4, '0')(`${at}`)}`))
    }
    yield* holdAt(page, 0)
  })

const Clipped = Schema.Array(
  Schema.Struct({
    name: Schema.String,
    needs: Schema.Finite,
    has: Schema.Finite,
  }),
)

const clippedNames = (page: Page) =>
  decodedFrom(Clipped, () =>
    page.evaluate(names => {
      const clipped: Array<{ name: string; needs: number; has: number }> = []
      for (const label of document.querySelectorAll('.lobby-hero-name')) {
        const was = label.textContent
        for (const name of names) {
          label.textContent = name
          if (label.scrollWidth > label.clientWidth) {
            clipped.push({
              name,
              needs: label.scrollWidth,
              has: label.clientWidth,
            })
          }
        }
        label.textContent = was
      }
      return clipped
    }, Record.values(CALLING_NAMES)),
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
    const maybeFrames = yield* Config.String('FRAMES').pipe(Config.option)
    const isFilming = Option.isSome(maybeFrames)
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

      yield* attempt(() => page.click('#home-play'))
      yield* attempt(() =>
        page.locator('.dare-fold').waitFor({ state: 'attached' }),
      )
      yield* holdAt(page, 0)
      const first = yield* measure(page)
      if (!isNear(first.fold, { ...first.play, bottom: first.fold.bottom })) {
        problems.push(`${viewport.name}: the fold does not start on PLAY`)
      }
      if (isFilming) {
        yield* film(page, name, 'open')
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

      yield* attempt(() => page.locator('.lobby-add-bot').first().click())
      yield* attempt(() =>
        page.locator('.lobby-hero-bot').waitFor({ state: 'attached' }),
      )
      yield* settleAnimations(page)
      yield* shot(page, name('bot'))
      const withBot = yield* measure(page)
      for (const { name: hero, needs, has } of yield* clippedNames(page)) {
        problems.push(
          `${where}: "${hero}" is cut off on a hero card (${needs}px in ${has}px)`,
        )
      }

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
      if (!isNear(folding.fold, withBot.card)) {
        problems.push(
          `${where}: the fold back does not start on the card (${boxText(folding.fold)} against ${boxText(withBot.card)})`,
        )
      }
      if (isFilming) {
        yield* stillCopy(page)
        yield* film(page, name, 'fold')
        yield* dropStillCopy(page)
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
