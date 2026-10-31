// The co-op pass: the CO-OP tile on the home menu (open and locked), the
// hub and its problem line, the code entry, asking, the QUICK PLAY queue,
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
import type { Page } from 'playwright-core'

import {
  SHOT_VIEWPORTS,
  TAG,
  type Viewport,
  deviceQuery,
  finish,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  shot,
  useHarness,
  wait,
} from './lib'

const SCENES: ReadonlyArray<Readonly<{ name: string; query: string }>> = [
  { name: 'locked', query: '' },
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

const checkButtons = async (
  page: Page,
  viewport: Viewport,
  label: string,
  problems: Array<string>,
) => {
  const found = await page.evaluate(
    ({ minTap, isPhone }) => {
      const scope = document.querySelector('.coop') ?? document
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
  )
  for (const line of found) {
    problems.push(`${label}: ${line}`)
  }
}

await useHarness()
const browser = await launch()
const problems: Array<string> = []
for (const viewport of SHOT_VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await openPage(browser, viewport)
    const label = `${viewport.name} ${scene.name}`
    page.on('pageerror', error => problems.push(`${label}: ${String(error)}`))
    await page.goto(harnessUrl('nodev', scene.query, deviceQuery(viewport)))
    await page.waitForSelector('canvas')
    await wait(900)
    await checkButtons(page, viewport, label, problems)
    await shot(page, `coop-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    await page.context().close()
  }
}
await browser.close()
finish(problems, 'The co-op pass found no problems.')
