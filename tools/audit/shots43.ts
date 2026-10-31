// The end of a run pass: a real death played tick by tick (the bite, the
// fall, the stamp, the card), the Game Over card with a NEW BEST, Victory
// with its trophy and confetti, and co-op's party wipe and win with the MVP
// crown, on a 1280x720 desktop, an 844x390 phone on its side, and a 390x844
// phone held upright, as `s43-<TAG>-<viewport>-<scene>.png`. The death is
// played with the harness's director (tools/audit/harness/director.ts), so
// its frames are the same on every run: it steps until the player falls,
// then shoots the beat at fixed ticks after. It checks that the end card
// shows its RETRY, HOME, and SHARE buttons once the beat is over, all one
// size, that a tap on SHARE opens the share sheet (or copies the post and
// flashes COPIED!) in the tap itself, and exits with 1 on any miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots43.ts
// ONLY picks scenes, such as `ONLY=death`, and VIEWPORTS picks screens.
import { Schema } from 'effect'
import type { Page } from 'playwright-core'

import { encodeJson } from '../json'
import {
  SHOT_VIEWPORTS,
  TAG,
  deviceQuery,
  finish,
  harnessQuery,
  harnessUrl,
  isPickedScene,
  launch,
  openPage,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
  waitForReady,
  whenSettled,
} from './lib'
import { evaluateAs } from './page'

const LEARNED =
  'learned=move,fire,startWave,shop,swap,pickup,timedBreaks,openBreak'
const BUTTONS = ['#end-retry-button', '#end-menu-button', '#end-share-button']

type Scene = Readonly<{
  name: string
  query: string
  buttons?: ReadonlyArray<string>
}>

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'gameover',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'gameover-best',
    query: `wave=12&mode=endless&phase=gameover&stats&best=9&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'victory',
    query: `wave=10&phase=victory&stats&difficulty=Hard&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'victory-confetti',
    query: `wave=10&phase=victory&stats&difficulty=Hard&${LEARNED}&tick=90`,
  },
  {
    name: 'coop-wipe',
    query: `wave=5&phase=gameover&stats&party=3&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-win',
    query: `wave=10&phase=victory&stats&party=3&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  { name: 'coop-ended', query: `coop=ended&${LEARNED}&tick=30` },
  { name: 'coop-result', query: `coop=result&${LEARNED}&tick=30` },
]

// NOTE: the death beat's ticks after the fall, shot one by one.
const DEATH_TICKS = [0, 4, 12, 24, 40, 60, 80, 100, 130, 170, 400]
const DEATH_SCENE = `wave=4&start=wave&elapsed=9000&crowd=40&seen=all&seed=7&${LEARNED}`
const STEP = 6
const MAX_TICKS = 60 * 40

// NOTE: a plan with no input, so the player stands and the crowd comes.
// The harness decodes it with its own Plan Schema (harness/director.ts).
const IDLE_PLAN = encodeJson(
  Schema.Struct({
    segments: Schema.Array(Schema.Unknown),
    taps: Schema.Array(Schema.Unknown),
    cards: Schema.Array(Schema.Unknown),
  }),
)({ segments: [], taps: [], cards: [] })

const directedTick = (page: Page) => page.evaluate(() => window.__directedTick)

const stepTo = async (page: Page, target: number) => {
  const now = await directedTick(page)
  if (now !== undefined && target > now) {
    await page.evaluate(n => window.__director.step(n), target - now)
    await page.waitForFunction(
      expected => window.__directedTick === expected,
      target,
      { polling: 'raf', timeout: 60_000 },
    )
  }
  await whenSettled(page)
}

const isOver = (page: Page) =>
  page.evaluate(() => window.__model.phase._tag === 'GameOver')

const shootDeath = async (
  browser: Awaited<ReturnType<typeof launch>>,
  viewport: (typeof SHOT_VIEWPORTS)[number],
  problems: Array<string>,
) => {
  const page = await openPage(browser, viewport)
  await page.goto(
    harnessUrl(DEATH_SCENE, 'director', 'nodev', deviceQuery(viewport)),
  )
  await waitForReady(page)
  await page.evaluate(json => window.__director.start(json), IDLE_PLAN)
  let tick = 0
  let lastAlive = 0
  while (tick < MAX_TICKS && !(await isOver(page))) {
    lastAlive = tick
    tick += STEP
    await stepTo(page, tick)
  }
  if (!(await isOver(page))) {
    problems.push(`${viewport.name} death: the player never fell`)
    await page.context().close()
    return
  }
  // NOTE: back up to the last alive frame and walk to the fall tick by tick.
  await page.goto(
    harnessUrl(DEATH_SCENE, 'director', 'nodev', deviceQuery(viewport)),
  )
  await waitForReady(page)
  await page.evaluate(json => window.__director.start(json), IDLE_PLAN)
  await stepTo(page, lastAlive)
  let fall = lastAlive
  while (!(await isOver(page))) {
    await shot(page, `s43-${TAG}-${viewport.name}-death-before`)
    fall += 1
    await stepTo(page, fall)
  }
  for (const after of DEATH_TICKS) {
    await stepTo(page, fall + after)
    await shot(page, `s43-${TAG}-${viewport.name}-death-${after}`)
  }
  console.log(`shot ${viewport.name} death (fell on tick ${fall})`)
  await page.context().close()
}

// NOTE: headless Chrome has no share sheet, so SHARE is checked on fresh
// pages with stand-ins. `Sheet` gives the page a navigator.share, `Refused`
// one that throws NotAllowedError as a browser that will not share does,
// and `Copy` none at all, so SHARE copies the post. Each stand-in records
// what it was handed, whether the tap's user activation was live, and
// whether the click was still being dispatched (window.event), as iOS
// Safari's share sheet needs. A tap on a phone goes through the game's own
// touch taps (src/touchTaps.ts); a desktop clicks.
const ShareMode = Schema.Literals(['Sheet', 'Refused', 'Copy'])
type ShareMode = typeof ShareMode.Type

const Shared = Schema.Struct({
  call: Schema.Literals(['Sheet', 'Copy']),
  text: Schema.String,
  isActive: Schema.Boolean,
  isInClick: Schema.Boolean,
})
const sharedJson = encodeJson(Shared)

const SHARE_SCENE = `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&tick=400`

const EXPECTED: Readonly<
  Record<ShareMode, Readonly<{ call: 'Sheet' | 'Copy'; label: string }>>
> = {
  Sheet: { call: 'Sheet', label: 'SHARE' },
  Refused: { call: 'Copy', label: 'COPIED!' },
  Copy: { call: 'Copy', label: 'COPIED!' },
}

const checkShare = async (
  viewport: (typeof SHOT_VIEWPORTS)[number],
  problems: Array<string>,
) => {
  for (const mode of ShareMode.literals) {
    const page = await openPage(browser, viewport)
    const label = `${viewport.name} share ${mode}`
    await page.addInitScript(picked => {
      const record = (call: 'Sheet' | 'Copy', text: string) => {
        window.__shared = [
          ...(window.__shared ?? []),
          {
            call,
            text,
            isActive: navigator.userActivation.isActive,
            isInClick: window.event?.type === 'click',
          },
        ]
      }
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: (line: string) => {
            record('Copy', line)
            return Promise.resolve()
          },
        },
      })
      if (picked === 'Copy') {
        Reflect.deleteProperty(Navigator.prototype, 'share')
      } else {
        navigator.share = (data?: ShareData) => {
          record('Sheet', `${data?.text ?? ''} ${data?.url ?? ''}`)
          return picked === 'Refused'
            ? Promise.reject(new DOMException('no', 'NotAllowedError'))
            : Promise.resolve()
        }
      }
    }, mode)
    await page.goto(harnessUrl(SHARE_SCENE, 'nodev', deviceQuery(viewport)))
    await waitForReady(page)
    await settleAnimations(page)
    const button = page.locator('button#end-share-button')
    if ((await button.count()) === 0) {
      problems.push(`${label}: no SHARE button`)
      await page.context().close()
      continue
    }
    await (viewport.isPhone ? button.tap() : button.click())
    await page.waitForFunction(() => window.__shared !== undefined, {
      timeout: 5_000,
    })
    await whenSettled(page)
    const calls = await evaluateAs(
      page,
      Schema.Array(Shared),
      () => window.__shared,
    )
    const [first] = calls
    const last = calls.at(-1)
    if (first === undefined || last === undefined) {
      problems.push(`${label}: nothing was shared`)
      await page.context().close()
      continue
    }
    // NOTE: a refused sheet copies after the refusal, so only the first
    // call must come in the tap.
    if (!first.isInClick || !first.isActive) {
      problems.push(`${label}: shared outside the tap: ${sharedJson(first)}`)
    }
    if (
      !first.text.includes('Munch Manor') ||
      !first.text.includes('https://munchmanor.com')
    ) {
      problems.push(`${label}: shared ${sharedJson(first)}`)
    }
    const expected = EXPECTED[mode]
    if (last.call !== expected.call) {
      problems.push(`${label}: ended with ${last.call}, not ${expected.call}`)
    }
    const shown = (await button.innerText()).replace(/\s+/g, ' ')
    if (!shown.includes(expected.label)) {
      problems.push(`${label}: SHARE reads ${shown}, not ${expected.label}`)
    }
    const shares = await page.evaluate(
      () =>
        window.__messages.filter(message => message === 'ClickedShareButton')
          .length,
    )
    if (shares !== 1) {
      problems.push(`${label}: ${shares} ClickedShareButton, not 1`)
    }
    if (mode !== 'Sheet') {
      await shot(page, `s43-${TAG}-${viewport.name}-share-copied`)
    }
    console.log(
      `${label}: ${last.call}, in the click ${first.isInClick ? 'yes' : 'no'}, reads ${shown}`,
    )
    await page.context().close()
  }
}

// NOTE: every end button is one size: the same width and height, to the
// pixel.
const checkEqualButtons = async (
  page: Page,
  label: string,
  problems: Array<string>,
) => {
  const sizes = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('.end-actions .end-button'),
      element => {
        const { width, height } = element.getBoundingClientRect()
        return `${Math.round(width)}x${Math.round(height)}`
      },
    ),
  )
  if (new Set(sizes).size > 1) {
    problems.push(`${label}: end buttons differ in size: ${sizes.join(', ')}`)
  }
}

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
const problems: Array<string> = []
for (const viewport of SHOT_VIEWPORTS) {
  if (isPickedScene('death')) {
    await shootDeath(browser, viewport, problems)
  }
  if (TAG !== 'before' && isPickedScene('share')) {
    await checkShare(viewport, problems)
  }
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    const label = `${viewport.name} ${scene.name}`
    await settleAnimations(page)
    for (const selector of scene.buttons ?? []) {
      if (TAG === 'before') {
        break
      }
      const isShown = await page.evaluate(
        target => document.querySelector(target) !== null,
        selector,
      )
      if (!isShown) {
        problems.push(`${label}: no ${selector}`)
      }
    }
    await shot(page, `s43-${TAG}-${viewport.name}-${scene.name}`)
    console.log(`shot ${label}`)
    if (TAG !== 'before' && scene.buttons !== undefined) {
      await checkEqualButtons(page, label, problems)
    }
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'The end of a run pass found no problems.')
