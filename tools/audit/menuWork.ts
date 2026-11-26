import {
  Array,
  Config,
  Console,
  Effect,
  Option,
  Record,
  Schema,
  String,
} from 'effect'
import type { Browser } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  closePage,
  desktop,
  harnessUrl,
  openBrowser,
  sceneReady,
  wait,
  waitForDialog,
  waitForLobby,
} from './lib'
import { attempt, decodedFrom, failWith } from './page'

const COUNTER = `(() => {
  const proto = WebGL2RenderingContext.prototype
  const state = { passes: 0, draws: 0, drewThisFrame: false, drawnFrames: 0, frames: 0 }
  const wrap = (name, before) => {
    const original = proto[name]
    proto[name] = function (...args) {
      before()
      return original.apply(this, args)
    }
  }
  wrap('bindFramebuffer', () => { state.passes += 1 })
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    wrap(name, () => {
      state.draws += 1
      state.drewThisFrame = true
    })
  }
  const tick = () => {
    state.frames += 1
    if (state.drewThisFrame) state.drawnFrames += 1
    state.drewThisFrame = false
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  window.__menuWork = state
})()`

const RESET = `(() => {
  const state = window.__menuWork
  state.passes = 0
  state.draws = 0
  state.drawnFrames = 0
  state.frames = 0
  window.__timings.update.length = 0
  window.__timings.view.length = 0
})()`

const READ = `(() => {
  const state = window.__menuWork
  return {
    frames: state.frames,
    drawnFrames: state.drawnFrames,
    passes: state.passes,
    draws: state.draws,
    updates: window.__timings.update.length,
    views: window.__timings.view.length,
  }
})()`

const Counts = Schema.Struct({
  frames: Schema.Finite,
  drawnFrames: Schema.Finite,
  passes: Schema.Finite,
  draws: Schema.Finite,
  updates: Schema.Finite,
  views: Schema.Finite,
})
type Counts = typeof Counts.Type

type Menu = Readonly<{
  query: string
  open: ReadonlyArray<string>
  isDialog: boolean
  isLobby: boolean
}>

const MANOR = '#home-manor'

const MENUS: Readonly<Record<string, Menu>> = {
  home: { query: '', open: [], isDialog: false, isLobby: false },
  lobby: {
    query: 'learned=move,fire&rank=300',
    open: ['#home-play'],
    isDialog: false,
    isLobby: true,
  },
  profile: { query: 'profile=look', open: [], isDialog: true, isLobby: false },
  munchopedia: {
    query: '',
    open: [MANOR, '#hand-card-munchopedia'],
    isDialog: true,
    isLobby: false,
  },
  pause: {
    query: 'wave=3&seen=all&start=wave&phase=paused',
    open: [],
    isDialog: false,
    isLobby: false,
  },
  end: {
    query: 'wave=3&seen=all&start=wave&phase=gameover',
    open: [],
    isDialog: false,
    isLobby: false,
  },
  coopLobby: { query: 'coop=lobby', open: [], isDialog: false, isLobby: false },
}

type Budget = Readonly<{ drawn: number; updates: number }>

const MENU_PACE: Budget = { drawn: 31, updates: 31 }

const BUDGETS: Readonly<Record<string, Budget>> = {
  home: MENU_PACE,
  lobby: MENU_PACE,
  profile: MENU_PACE,
  munchopedia: MENU_PACE,
  coopLobby: MENU_PACE,
  pause: { drawn: 1, updates: 1 },
  end: { drawn: 1, updates: 61 },
}

const overBudget = (
  input: Readonly<{
    label: string
    count: number
    budget: number
    what: string
  }>,
): Option.Option<string> =>
  input.count > input.budget
    ? Option.some(
        `${input.label}: ${input.count.toFixed(1)} ${input.what} a second, past ${input.budget}`,
      )
    : Option.none()

const countsOf = (
  input: Readonly<{
    browser: Browser
    menu: Menu
    seconds: number
    isStill: boolean
  }>,
) =>
  Effect.gen(function* () {
    const { browser, menu, seconds, isStill } = input
    const page = yield* desktop(browser)
    if (isStill) {
      yield* attempt(() => page.emulateMedia({ reducedMotion: 'reduce' }))
    }
    yield* attempt(() => page.addInitScript({ content: COUNTER }))
    yield* attempt(() => page.goto(harnessUrl(menu.query, 'instrument')))
    yield* sceneReady(page)
    yield* Effect.forEach(menu.open, selector =>
      Effect.andThen(
        attempt(() => page.click(selector)),
        wait(600),
      ),
    )
    if (menu.isDialog) {
      yield* waitForDialog(page)
    }
    if (menu.isLobby) {
      yield* waitForLobby(page)
    }
    yield* wait(2500)
    yield* attempt(() => page.evaluate(RESET))
    yield* wait(seconds * 1000)
    const counts = yield* decodedFrom(Counts, () => page.evaluate(READ))
    yield* closePage(page)
    return counts
  })

const perSecond = (n: number, seconds: number) => (n / seconds).toFixed(1)

const lineOf = (name: string, counts: Counts, seconds: number) =>
  `${String.padEnd(18)(name)} ${String.padStart(7)(perSecond(counts.frames, seconds))} ${String.padStart(7)(perSecond(counts.updates, seconds))} ${String.padStart(7)(perSecond(counts.views, seconds))} ${String.padStart(7)(perSecond(counts.drawnFrames, seconds))} ${String.padStart(8)(perSecond(counts.passes, seconds))} ${String.padStart(8)(perSecond(counts.draws, seconds))}`

runHarnessAudit(
  Effect.gen(function* () {
    const seconds = yield* Config.String('SECONDS').pipe(
      Config.withDefault('4'),
      Config.map(Number),
    )
    const isMotionToo = yield* Config.String('MOTION').pipe(
      Config.withDefault('1'),
      Config.map(text => text !== '0'),
    )
    const names = yield* Config.String('ONLY').pipe(
      Config.withDefault(Array.join(Record.keys(MENUS), ',')),
      Config.map(text =>
        Array.filter(String.split(',')(text), name => name !== ''),
      ),
    )
    const browser = yield* openBrowser
    yield* Console.log(
      `per second             rAF  update    view   drawn   passes    draws`,
    )
    const runs = Array.flatMap(names, name =>
      isMotionToo
        ? [
            { name, isStill: false },
            { name, isStill: true },
          ]
        : [{ name, isStill: false }],
    )
    const over = yield* Effect.forEach(runs, ({ name, isStill }) =>
      Effect.gen(function* () {
        const menu = Option.fromUndefinedOr(MENUS[name])
        if (Option.isNone(menu)) {
          return yield* failWith(`unknown menu ${name}`)
        }
        const counts = yield* countsOf({
          browser,
          menu: menu.value,
          seconds,
          isStill,
        })
        const label = isStill ? `${name}Still` : name
        yield* Console.log(lineOf(label, counts, seconds))
        return Option.match(Option.fromUndefinedOr(BUDGETS[name]), {
          onNone: () => [],
          onSome: budget => [
            overBudget({
              label,
              count: counts.drawnFrames / seconds,
              budget: budget.drawn,
              what: 'world frames drawn',
            }),
            overBudget({
              label,
              count: counts.updates / seconds,
              budget: budget.updates,
              what: 'frames updated',
            }),
          ],
        })
      }),
    )
    const failures = Array.getSomes(Array.flatten(over))
    if (failures.length > 0) {
      return yield* failWith(`menus over budget: ${Array.join(failures, '; ')}`)
    }
    yield* Console.log('\nidle menus within budget')
  }),
)
