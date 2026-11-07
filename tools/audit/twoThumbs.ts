// Two thumbs on the HUD: with one finger held on the move stick and moving,
// a second finger taps the other gun's slot, the melee slot, the held gun's
// slot, and the reload button, on an 844x390 phone on its side and a 390x844 phone held
// upright, with real multi-touch (CDP Input.dispatchTouchEvent, two touch
// points at once). It checks that each tap does what a lone tap does (the
// gun swaps, the melee weapon comes out, the reload starts) while the stick
// stays held, and shoots `tt-<TAG>-<viewport>-<scene>.png` with both fingers down.
// Exits with 1 on any miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/twoThumbs.ts
// VIEWPORTS picks screens, such as `VIEWPORTS=l844`.
import { Array, Console, Effect, Schema, String } from 'effect'
import type { CDPSession, Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  PHONE_844,
  type ScenePages,
  UPRIGHT_390,
  type Viewport,
  auditTag,
  finish,
  modelAs,
  openBrowser,
  pickViewports,
  scenePages,
  shot,
  wait,
} from './lib'
import { attempt, failWith } from './page'
import { LEARNED } from './scenes'

const VIEWPORTS = [
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
]

// NOTE: a live wave (no `tick`), so the subscriptions and the frames run
// as on a phone. The SMG's magazine is part spent, so a reload has rounds
// to take.
const FIGHTING = `wave=4&seen=all&start=wave&elapsed=9000&god&gun=smg&loaded=4&${LEARNED}&device=touch`

type Point = Readonly<{ x: number; y: number }>

const MOVE_ID = 1
const TAP_ID = 2
const STEP_MS = 40

const touch = (
  session: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  points: ReadonlyArray<Readonly<{ id: number; at: Point }>>,
) =>
  attempt(() =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: Array.map(points, ({ id, at }) => ({
        id,
        x: at.x,
        y: at.y,
        radiusX: 4,
        radiusY: 4,
        force: 1,
      })),
    }),
  )

// NOTE: where the left thumb lands: low on the left of the world, clear of
// the HUD's buttons.
const stickPoint = (page: Page) =>
  attempt((): Promise<Point> =>
    page.evaluate(() => {
      const surface = document.querySelector('.game-surface')
      if (surface === null) {
        throw new Error('No .game-surface on the page')
      }
      const box = surface.getBoundingClientRect()
      const thumbArea = document.querySelector('.thumb-area')
      const top =
        thumbArea === null ? box.top : thumbArea.getBoundingClientRect().top
      return {
        x: box.left + box.width * 0.18,
        y: top + (box.bottom - top) * 0.45,
      }
    }),
  )

const centerOf = (page: Page, selector: string) =>
  Effect.gen(function* () {
    const box = yield* attempt(() =>
      page.locator(selector).first().boundingBox(),
    )
    if (box === null) {
      return yield* failWith(`nothing at ${selector}`)
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })

const Tagged = Schema.Struct({ _tag: Schema.String })

// NOTE: as much of the Model as the checks read.
const ThumbView = Schema.Struct({
  input: Schema.Struct({ moveStick: Tagged }),
  player: Schema.Struct({
    arsenal: Tagged,
    wield: Schema.String,
    reload: Tagged,
  }),
})
type ThumbView = typeof ThumbView.Type

type Check = Readonly<{
  name: string
  selector: string
  // NOTE: what the tap should have done, read from the Model before and
  // after; a miss names what went wrong.
  verdict: (before: ThumbView, after: ThumbView) => string | undefined
}>

const isMoving = (m: ThumbView): boolean => m.input.moveStick._tag === 'Active'

const CHECKS: ReadonlyArray<Check> = [
  {
    name: 'swap',
    selector: '.gun-slot-button[data-held="false"]:not([data-slot="Melee"])',
    verdict: (before, after) =>
      before.player.arsenal._tag === after.player.arsenal._tag
        ? 'the other gun did not come out'
        : undefined,
  },
  {
    name: 'knife',
    selector: '.gun-slot-button[data-slot="Melee"]',
    verdict: (_before, after) =>
      after.player.wield === 'Melee' ? undefined : 'the knife did not come out',
  },
  {
    name: 'slot-reload',
    selector: '.gun-slot-button[data-held="true"]',
    verdict: (_before, after) =>
      after.player.reload._tag === 'Reloading'
        ? undefined
        : 'a tap on the held gun did not reload',
  },
  {
    name: 'reload',
    selector: '.reload-button, .reload-icon-button',
    verdict: (_before, after) =>
      after.player.reload._tag === 'Reloading'
        ? undefined
        : 'the reload button did not reload',
  },
]

// NOTE: the run's guns are spent down a little so a reload has rounds to
// take, then the left thumb goes down, walks, and stays; the right thumb
// taps the target; then both lift.
const twoThumbTap = (
  page: Page,
  session: CDPSession,
  shotTag: string,
  check: Check,
  problems: Array<string>,
  label: string,
) =>
  Effect.gen(function* () {
    const stick = yield* stickPoint(page)
    yield* touch(session, 'touchStart', [{ id: MOVE_ID, at: stick }])
    for (const step of [10, 20, 30]) {
      yield* wait(STEP_MS)
      yield* touch(session, 'touchMove', [
        { id: MOVE_ID, at: { x: stick.x + step, y: stick.y - step / 2 } },
      ])
    }
    const held = { x: stick.x + 30, y: stick.y - 15 }
    yield* wait(STEP_MS)
    const target = yield* centerOf(page, check.selector)
    yield* attempt(() =>
      page.evaluate(() => {
        window.__messages.length = 0
      }),
    )
    const before = yield* modelAs(page, ThumbView)
    if (!isMoving(before)) {
      problems.push(`${label}: the move stick is not held before the tap`)
    }
    yield* touch(session, 'touchStart', [
      { id: MOVE_ID, at: held },
      { id: TAP_ID, at: target },
    ])
    yield* wait(STEP_MS)
    yield* shot(page, `tt-${shotTag}-${String.replace(' ', '-')(label)}`)
    // NOTE: Chrome's touch emulation lifts the fingers a touchEnd lists, and
    // a touchStart lists every finger still down.
    yield* touch(session, 'touchEnd', [{ id: TAP_ID, at: target }])
    yield* wait(STEP_MS * 3)
    const after = yield* modelAs(page, ThumbView)
    const tags: ReadonlyArray<string> = yield* attempt(() =>
      page.evaluate(() => [...window.__messages]),
    )
    if (!isMoving(after)) {
      problems.push(`${label}: the tap let go of the move stick`)
    }
    const miss = check.verdict(before, after)
    if (miss !== undefined) {
      problems.push(
        `${label}: ${miss} (messages: ${Array.join([...new Set(tags)], ', ')})`,
      )
    }
    yield* Console.log(
      `${miss === undefined ? 'ok  ' : 'FAIL'} ${label}: ${Array.join([...new Set(Array.filter(tags, tag => !String.startsWith('Ticked')(tag) && !String.startsWith('Moved')(tag)))], ', ')}`,
    )
    yield* touch(session, 'touchEnd', [{ id: MOVE_ID, at: held }])
    yield* wait(STEP_MS)
  })

const runViewport = (
  pages: ScenePages,
  shotTag: string,
  viewport: Viewport,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    for (const check of CHECKS) {
      const page = yield* pages.open(viewport, FIGHTING, { fresh: true })
      const session = yield* attempt(() => page.context().newCDPSession(page))
      yield* wait(300)
      yield* twoThumbTap(
        page,
        session,
        shotTag,
        check,
        problems,
        `${viewport.name} ${check.name}`,
      )
      yield* attempt(() => session.detach())
      pages.release(page)
    }
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* pickViewports(VIEWPORTS)
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const problems: Array<string> = []
    for (const viewport of viewports) {
      yield* runViewport(pages, tag, viewport, problems)
    }
    yield* pages.close
    yield* finish(
      problems,
      'Every second-thumb tap did its job with the stick held.',
    )
  }),
)
