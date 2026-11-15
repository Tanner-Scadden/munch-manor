import {
  Array,
  Config,
  Console,
  Effect,
  Option,
  Order,
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
} from './lib'
import { attempt, decodedFrom, failWith } from './page'
import { SCENARIOS } from './scenarios'

// NOTE: the GPU's work in a frame, counted on the WebGL2 context: every
// render pass (a framebuffer bound and the viewport it draws), its draw
// calls, its clears, and the pixels those clears cover, by the pass's size.
// The CPU's side is in spikes.ts and profile.ts; this is the side that
// heats a phone, where a whole-level texture drawn again each frame, or a
// shadow map no light needs, costs fill and bandwidth that frame time on a
// desktop hides. `FRAMES` says how many to count.
const COUNTER = `(() => {
  const proto = WebGL2RenderingContext.prototype
  const state = { passes: [], current: undefined, w: 0, h: 0, frames: 0 }
  const open = () => {
    state.current = { w: state.w, h: state.h, draws: 0, clears: 0 }
    state.passes.push(state.current)
  }
  const wrap = (name, before) => {
    const original = proto[name]
    proto[name] = function (...args) {
      before(args)
      return original.apply(this, args)
    }
  }
  wrap('bindFramebuffer', () => { state.current = undefined })
  wrap('viewport', args => {
    state.w = args[2]
    state.h = args[3]
    if (state.current !== undefined && state.current.draws === 0 && state.current.clears === 0) {
      state.current.w = state.w
      state.current.h = state.h
    } else {
      state.current = undefined
    }
  })
  const draw = () => {
    if (state.current === undefined) open()
    state.current.draws += 1
  }
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    wrap(name, draw)
  }
  wrap('clear', () => {
    if (state.current === undefined) open()
    state.current.clears += 1
  })
  window.__gpuWork = state
})()`

const COUNT = (frames: number) => `new Promise(resolve => {
  const state = window.__gpuWork
  let left = ${frames}
  const tick = () => {
    if (left === ${frames}) {
      state.passes = []
      state.current = undefined
    }
    left -= 1
    if (left >= 0) {
      requestAnimationFrame(tick)
      return
    }
    const bySize = {}
    for (const pass of state.passes) {
      const key = pass.w + 'x' + pass.h
      const row = bySize[key] ?? { size: key, width: pass.w, height: pass.h, pixels: pass.w * pass.h, passes: 0, draws: 0, clears: 0 }
      row.passes += 1
      row.draws += pass.draws
      row.clears += pass.clears
      bySize[key] = row
    }
    resolve(Object.values(bySize))
  }
  requestAnimationFrame(tick)
})`

const PassRow = Schema.Struct({
  size: Schema.String,
  width: Schema.Finite,
  height: Schema.Finite,
  pixels: Schema.Finite,
  passes: Schema.Finite,
  draws: Schema.Finite,
  clears: Schema.Finite,
})

type PassRow = typeof PassRow.Type

// NOTE: a shadow map is a square pass of 512 or more a side: the screen,
// the floor's pictures, and the bloom's halvings never are.
const isShadowPass = ({ width, height }: PassRow): boolean =>
  width === height && width >= 512

// NOTE: the most shadow maps a frame each scenario may draw, counted by
// their clears: the maps are layers of one framebuffer, so one bind draws
// several. In a break
// nothing moves under the lights but the players, so the fills keep their
// maps (src/render/iso/shadowWatch.ts): 0.16 when the watch came in, 0.99
// before, a map drawn again every frame. A wave in every room moves bodies
// under each lit fill, at most the four fills near the view (3.53).
const SHADOW_BUDGETS: Readonly<Record<string, number>> = {
  idle: 0.35,
  allRooms: 4.2,
}

const passRowsOf = (
  input: Readonly<{
    browser: Browser
    name: string
    frames: number
    warmMs: number
  }>,
) =>
  Effect.gen(function* () {
    const { browser, name, frames, warmMs } = input
    const scenario = Option.fromUndefinedOr(SCENARIOS[name])
    if (Option.isNone(scenario)) {
      return yield* failWith(`unknown scenario ${name}`)
    }
    const page = yield* desktop(browser)
    yield* attempt(() => page.addInitScript({ content: COUNTER }))
    yield* attempt(() =>
      page.goto(harnessUrl(String.slice(1)(scenario.value.q))),
    )
    yield* sceneReady(page)
    yield* scenario.value.warm
    yield* wait(warmMs)
    const rows = yield* decodedFrom(Schema.Array(PassRow), () =>
      page.evaluate(COUNT(frames)),
    )
    yield* closePage(page)
    return rows
  })

const report = (
  input: Readonly<{
    name: string
    frames: number
    rows: ReadonlyArray<PassRow>
  }>,
) =>
  Effect.gen(function* () {
    const { name, frames, rows } = input
    const perFrame = (n: number) => (n / frames).toFixed(2)
    const sorted = Array.sort(
      rows,
      Order.mapInput(Order.Number, (row: PassRow) => -row.pixels * row.passes),
    )
    yield* Console.log(
      `${name}, ${frames} frames, per frame (size: passes, draws, clears, Mpx cleared)`,
    )
    yield* Effect.forEach(sorted, row =>
      Console.log(
        `${String.padStart(11)(row.size)}: ${perFrame(row.passes)} passes, ${perFrame(row.draws)} draws, ${perFrame(row.clears)} clears, ${((row.pixels * row.clears) / frames / 1e6).toFixed(2)} Mpx`,
      ),
    )
    const total = Array.reduce(rows, { draws: 0, passes: 0 }, (sum, row) => ({
      draws: sum.draws + row.draws,
      passes: sum.passes + row.passes,
    }))
    yield* Console.log(
      `total: ${perFrame(total.passes)} passes, ${perFrame(total.draws)} draws\n`,
    )
  })

// NOTE: `SCENARIOS` picks scenarios (`idle,allRooms` by default), and each
// one with a budget fails the audit past it.
runHarnessAudit(
  Effect.gen(function* () {
    const frames = yield* Config.String('FRAMES').pipe(
      Config.withDefault('120'),
      Config.map(Number),
    )
    const warmMs = yield* Config.String('WARM').pipe(
      Config.withDefault('2500'),
      Config.map(Number),
    )
    const names = yield* Config.String('SCENARIOS').pipe(
      Config.withDefault('idle,allRooms'),
      Config.map(text =>
        Array.filter(String.split(',')(text), name => name !== ''),
      ),
    )
    const browser = yield* openBrowser
    const over = yield* Effect.forEach(names, name =>
      Effect.gen(function* () {
        const rows = yield* passRowsOf({ browser, name, frames, warmMs })
        yield* report({ name, frames, rows })
        const shadowMaps =
          Array.reduce(
            Array.filter(rows, isShadowPass),
            0,
            (sum, row) => sum + row.clears,
          ) / frames
        return Option.flatMap(
          Option.fromUndefinedOr(SHADOW_BUDGETS[name]),
          budget =>
            shadowMaps > budget
              ? Option.some(
                  `${name}: ${shadowMaps.toFixed(2)} shadow maps drawn a frame, past ${budget}`,
                )
              : Option.none(),
        )
      }),
    )
    const failures = Array.getSomes(over)
    if (failures.length > 0) {
      return yield* failWith(
        `GPU work over budget: ${Array.join(failures, '; ')}`,
      )
    }
    yield* Console.log('GPU work within budget')
  }),
)
