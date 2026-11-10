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
import { Array, Console, Effect, Option, Schema, String } from 'effect'
import type { Browser, Page } from 'playwright-core'

import { encodeJson } from '../json'
import { runHarnessAudit } from './harnessServer'
import {
  type Viewport,
  auditTag,
  closePage,
  deviceQuery,
  finish,
  harnessQuery,
  harnessUrl,
  isPickedScene,
  openBrowser,
  openPage,
  scenePages,
  sceneReady,
  settleAnimations,
  settled,
  shot,
  shotViewports,
} from './lib'
import { attempt, evaluateAs } from './page'

const LEARNED =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey'
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
    query: `wave=10&phase=escaped&stats&difficulty=Hard&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'victory-confetti',
    query: `wave=10&phase=escaped&stats&difficulty=Hard&${LEARNED}&tick=90`,
  },
  // NOTE: the rank strip: a bar part way through a rank, mid fill into a new
  // rank, the finished rank up, a win into the next badge, and a crew's.
  {
    name: 'gameover-rank',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=162&rankgain=60&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'gameover-rankmid',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=130&rankgain=60&tick=195`,
  },
  {
    name: 'gameover-rankup',
    query: `wave=6&phase=gameover&stats&crowd=10&${LEARNED}&rank=130&rankgain=60&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'victory-rankup',
    query: `wave=10&phase=escaped&stats&difficulty=Hard&${LEARNED}&rank=1900&rankgain=250&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-win-rank',
    query: `wave=10&phase=escaped&stats&party=3&${LEARNED}&rank=2400&rankgain=95&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-wipe-rank',
    query: `wave=5&phase=gameover&stats&party=4&crowd=10&${LEARNED}&rank=240&rankgain=95&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-win-rank-4',
    query: `wave=10&phase=escaped&stats&party=4&${LEARNED}&rank=2400&rankgain=95&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-wipe-rank-2',
    query: `wave=5&phase=gameover&stats&party=2&crowd=10&${LEARNED}&rank=240&rankgain=95&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-wipe',
    query: `wave=5&phase=gameover&stats&party=3&crowd=10&${LEARNED}&tick=400`,
    buttons: BUTTONS,
  },
  {
    name: 'coop-win',
    query: `wave=10&phase=escaped&stats&party=3&${LEARNED}&tick=400`,
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

const directedTick = (page: Page) =>
  attempt(() => page.evaluate(() => window.__directedTick))

const stepTo = (page: Page, target: number) =>
  Effect.gen(function* () {
    const now = yield* directedTick(page)
    if (now !== undefined && target > now) {
      yield* attempt(() =>
        page.evaluate(n => window.__director.step(n), target - now),
      )
      yield* attempt(() =>
        page.waitForFunction(
          expected => window.__directedTick === expected,
          target,
          { polling: 'raf', timeout: 60_000 },
        ),
      )
    }
    yield* settled(page)
  })

const isOver = (page: Page) =>
  attempt(() => page.evaluate(() => window.__model.phase._tag === 'GameOver'))

const startDeath = (page: Page, viewport: Viewport) =>
  Effect.gen(function* () {
    yield* attempt(() =>
      page.goto(
        harnessUrl(DEATH_SCENE, 'director', 'nodev', deviceQuery(viewport)),
      ),
    )
    yield* sceneReady(page)
    yield* attempt(() =>
      page.evaluate(json => window.__director.start(json), IDLE_PLAN),
    )
  })

const shootDeath = (
  browser: Browser,
  tag: string,
  viewport: Viewport,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const page = yield* openPage(browser, viewport)
    yield* startDeath(page, viewport)
    let tick = 0
    let lastAlive = 0
    while (tick < MAX_TICKS && !(yield* isOver(page))) {
      lastAlive = tick
      tick += STEP
      yield* stepTo(page, tick)
    }
    if (!(yield* isOver(page))) {
      problems.push(`${viewport.name} death: the player never fell`)
      yield* closePage(page)
      return
    }
    // NOTE: back up to the last alive frame and walk to the fall tick by
    // tick.
    yield* startDeath(page, viewport)
    yield* stepTo(page, lastAlive)
    let fall = lastAlive
    while (!(yield* isOver(page))) {
      yield* shot(page, `s43-${tag}-${viewport.name}-death-before`)
      fall += 1
      yield* stepTo(page, fall)
    }
    for (const after of DEATH_TICKS) {
      yield* stepTo(page, fall + after)
      yield* shot(page, `s43-${tag}-${viewport.name}-death-${after}`)
    }
    yield* Console.log(`shot ${viewport.name} death (fell on tick ${fall})`)
    yield* closePage(page)
  })

// NOTE: headless Chrome has no share sheet, so SHARE is checked on fresh
// pages with stand-ins. `Sheet` gives the page a navigator.share, `Refused`
// one that throws NotAllowedError as a browser that will not share does,
// and `Copy` none at all, so SHARE copies the post. Each stand-in records
// what it was handed, whether the tap's user activation was live, and
// whether the click was still being dispatched (window.event), as iOS
// Safari's share sheet needs. A tap on a phone goes through the game's own
// touch taps (src/input/touchTaps.ts); a desktop clicks.
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

const standIns = (picked: ShareMode) => {
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
}

const checkShareMode = (
  browser: Browser,
  tag: string,
  viewport: Viewport,
  mode: ShareMode,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const page = yield* openPage(browser, viewport)
    const label = `${viewport.name} share ${mode}`
    yield* attempt(() => page.addInitScript(standIns, mode))
    yield* attempt(() =>
      page.goto(harnessUrl(SHARE_SCENE, 'nodev', deviceQuery(viewport))),
    )
    yield* sceneReady(page)
    yield* settleAnimations(page)
    const button = page.locator('button#end-share-button')
    const buttonCount = yield* attempt(() => button.count())
    if (buttonCount === 0) {
      problems.push(`${label}: no SHARE button`)
      yield* closePage(page)
      return
    }
    yield* attempt(() => (viewport.isPhone ? button.tap() : button.click()))
    yield* attempt(() =>
      page.waitForFunction(() => window.__shared !== undefined, {
        timeout: 5_000,
      }),
    )
    yield* settled(page)
    const calls = yield* evaluateAs(
      page,
      Schema.Array(Shared),
      () => window.__shared,
    )
    const ends = Option.all([Array.head(calls), Array.last(calls)])
    if (Option.isNone(ends)) {
      problems.push(`${label}: nothing was shared`)
      yield* closePage(page)
      return
    }
    const [first, last] = ends.value
    // NOTE: a refused sheet copies after the refusal, so only the first
    // call must come in the tap.
    if (!first.isInClick || !first.isActive) {
      problems.push(`${label}: shared outside the tap: ${sharedJson(first)}`)
    }
    if (
      !String.includes('Munch Manor')(first.text) ||
      !String.includes('https://munchmanor.com')(first.text)
    ) {
      problems.push(`${label}: shared ${sharedJson(first)}`)
    }
    const expected = EXPECTED[mode]
    if (last.call !== expected.call) {
      problems.push(`${label}: ended with ${last.call}, not ${expected.call}`)
    }
    const text = yield* attempt(() => button.innerText())
    const shown = String.replace(/\s+/g, ' ')(text)
    if (!String.includes(expected.label)(shown)) {
      problems.push(`${label}: SHARE reads ${shown}, not ${expected.label}`)
    }
    const shares = yield* attempt(() =>
      page.evaluate(
        () =>
          // NOTE: runs in the page, which has no effect module.
          // @effect-diagnostics-next-line preferEffectArray:off
          window.__messages.filter(message => message === 'ClickedShareButton')
            .length,
      ),
    )
    if (shares !== 1) {
      problems.push(`${label}: ${shares} ClickedShareButton, not 1`)
    }
    if (mode !== 'Sheet') {
      yield* shot(page, `s43-${tag}-${viewport.name}-share-copied`)
    }
    yield* Console.log(
      `${label}: ${last.call}, in the click ${first.isInClick ? 'yes' : 'no'}, reads ${shown}`,
    )
    yield* closePage(page)
  })

const checkShare = (
  browser: Browser,
  tag: string,
  viewport: Viewport,
  problems: Array<string>,
) =>
  Effect.forEach(
    ShareMode.literals,
    mode => checkShareMode(browser, tag, viewport, mode, problems),
    { discard: true },
  )

// NOTE: every end button is one size: the same width and height, to the
// pixel.
const checkEqualButtons = (
  page: Page,
  label: string,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const sizes = yield* attempt(() =>
      page.evaluate(() =>
        globalThis.Array.from(
          document.querySelectorAll('.end-actions .end-button'),
          element => {
            const { width, height } = element.getBoundingClientRect()
            return `${Math.round(width)}x${Math.round(height)}`
          },
        ),
      ),
    )
    if (new Set(sizes).size > 1) {
      problems.push(
        `${label}: end buttons differ in size: ${Array.join(sizes, ', ')}`,
      )
    }
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* shotViewports
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const problems: Array<string> = []
    for (const viewport of viewports) {
      if (yield* isPickedScene('death')) {
        yield* shootDeath(browser, tag, viewport, problems)
      }
      if (tag !== 'before' && (yield* isPickedScene('share'))) {
        yield* checkShare(browser, tag, viewport, problems)
      }
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        const label = `${viewport.name} ${scene.name}`
        yield* settleAnimations(page)
        for (const selector of scene.buttons ?? []) {
          if (tag === 'before') {
            break
          }
          const isShown = yield* attempt(() =>
            page.evaluate(
              target => document.querySelector(target) !== null,
              selector,
            ),
          )
          if (!isShown) {
            problems.push(`${label}: no ${selector}`)
          }
        }
        yield* shot(page, `s43-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        if (tag !== 'before' && scene.buttons !== undefined) {
          yield* checkEqualButtons(page, label, problems)
        }
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(problems, 'The end of a run pass found no problems.')
  }),
)
