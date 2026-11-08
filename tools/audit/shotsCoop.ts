// The co-op pass: the CO-OP tile on the home menu (a new player's, open from
// the first visit, and a staged one), the hub and its problem line, the
// code entry, asking, the QUICK PLAY queue,
// the offer to start with fewer and its accepted look, the lobby (with a
// host's kicks, READY stamps, and the last run's result), and the in-room
// arena (playing, away, and ended), on a 1280x720 desktop, an 844x390
// phone held sideways, and a 390x844 phone held upright, as
// `coop-<TAG>-<viewport>-<scene>.png`. Every screen is staged by the
// harness's `coop=` key with a network that never answers. It exits with 1
// on a phone button under 48 px, a button covered at its center or off
// screen, or a page that scrolls.
//   TAG=after BASE=http://localhost:4174/ bun tools/audit/shotsCoop.ts
// ONLY picks scenes, such as `ONLY=hub,lobby`, and VIEWPORTS picks screens.
import { Console, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  type Viewport,
  auditTag,
  closePage,
  deviceQuery,
  finish,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  shot,
  shotViewports,
  wait,
} from './lib'
import { attempt } from './page'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'new', query: '' },
  { name: 'tile', query: 'coop=tile' },
  { name: 'hub', query: 'coop=hub' },
  { name: 'problem', query: 'coop=problem' },
  { name: 'code', query: 'coop=code' },
  { name: 'asking', query: 'coop=asking' },
  { name: 'queue', query: 'coop=queue' },
  { name: 'offer', query: 'coop=offer' },
  { name: 'accepted', query: 'coop=accepted' },
  { name: 'lobby', query: 'coop=lobby' },
  { name: 'host', query: 'coop=host' },
  { name: 'picks', query: 'coop=picks' },
  { name: 'heroes', query: 'coop=heroes' },
  { name: 'name', query: 'coop=name' },
  { name: 'herosale', query: 'coop=herosale&bones=150&spent=0' },
  { name: 'heroshort', query: 'coop=heroshort&bones=40&spent=0' },
  {
    name: 'herobought',
    query:
      'coop=heroes&bones=150&spent=100&bought=hero:Handyman,hero:TrackStar',
  },
  { name: 'guest', query: 'coop=guest' },
  { name: 'nudge', query: 'coop=nudge' },
  { name: 'padlock', query: 'coop=padlock' },
  { name: 'keep', query: 'coop=keep' },
  { name: 'ready', query: 'coop=ready' },
  { name: 'result', query: 'coop=result' },
  { name: 'arena', query: 'coop=arena' },
  { name: 'away', query: 'coop=away' },
  { name: 'ended', query: 'coop=ended' },
  { name: 'card', query: 'coop=card' },
  { name: 'cardwon', query: 'coop=cardwon' },
  { name: 'cardduo', query: 'coop=cardduo' },
]

const MIN_PHONE_TAP = 48

const checkButtons = (
  page: Page,
  viewport: Viewport,
  label: string,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const found = yield* attempt(() =>
      page.evaluate(
        ({ minTap, isPhone }) => {
          // NOTE: the hero picker covers the lobby, so only its own buttons count.
          const scope =
            document.querySelector('.coop-calling-picker') ??
            document.querySelector('.coop-name-picker') ??
            document.querySelector('.coop') ??
            document
          const buttons = Array.from(scope.querySelectorAll('button'))
          const lines: Array<string> = []
          const scrolls =
            document.scrollingElement !== null &&
            (document.scrollingElement.scrollHeight > innerHeight + 1 ||
              document.scrollingElement.scrollWidth > innerWidth + 1)
          if (scrolls) {
            lines.push('the page scrolls')
          }
          for (const button of buttons) {
            const box = button.getBoundingClientRect()
            if (box.width === 0 || box.height === 0) {
              continue
            }
            const name = button.getAttribute('aria-label') ?? button.textContent
            if (isPhone && (box.width < minTap || box.height < minTap)) {
              lines.push(
                `${name} is ${Math.round(box.width)}x${Math.round(box.height)}`,
              )
            }
            const x = box.left + box.width / 2
            const y = box.top + box.height / 2
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
              lines.push(`${name} is off screen`)
              continue
            }
            const hit = document.elementFromPoint(x, y)
            if (hit === null || !button.contains(hit)) {
              lines.push(`${name} is covered at its center`)
            }
          }
          return lines
        },
        { minTap: MIN_PHONE_TAP, isPhone: viewport.isPhone },
      ),
    )
    for (const line of found) {
      problems.push(`${label}: ${line}`)
    }
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const problems: Array<string> = []
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* openPage(browser, viewport)
        const label = `${viewport.name} ${scene.name}`
        page.on('pageerror', error =>
          problems.push(`${label}: ${String(error)}`),
        )
        yield* attempt(() =>
          page.goto(harnessUrl('nodev', scene.query, deviceQuery(viewport))),
        )
        yield* attempt(() => page.waitForSelector('canvas'))
        yield* wait(900)
        // NOTE: a shot shows an ended animation at its end, and the note's end
        // is gone, so hold it at its start.
        yield* attempt(() =>
          page.addStyleTag({
            content: '.coop-nudge { animation: none !important; opacity: 1; }',
          }),
        )
        yield* checkButtons(page, viewport, label, problems)
        yield* shot(page, `coop-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        yield* closePage(page)
      }
    }
    yield* finish(problems, 'The co-op pass found no problems.')
  }),
)
