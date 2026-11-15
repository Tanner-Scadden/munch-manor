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

import { runHarnessAudit } from './harnessServer'
import { desktop, harnessUrl, openBrowser, sceneReady, wait } from './lib'
import { attempt, decodedFrom, failWith } from './page'
import { SCENARIOS } from './scenarios'

// NOTE: the GPU's work in a frame, counted on the WebGL2 context: every
// render pass (a framebuffer bound and the viewport it draws), its draw
// calls, its clears, and the pixels those clears cover, by the pass's size.
// The CPU's side is in spikes.ts and profile.ts; this is the side that
// heats a phone, where a whole-level texture drawn again each frame, or a
// shadow map no light needs, costs fill and bandwidth that frame time on a
// desktop hides. `SCENARIO` names one in scenarios.ts, `FRAMES` how many to
// count.
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
      const row = bySize[key] ?? { size: key, pixels: pass.w * pass.h, passes: 0, draws: 0, clears: 0 }
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
  pixels: Schema.Finite,
  passes: Schema.Finite,
  draws: Schema.Finite,
  clears: Schema.Finite,
})

runHarnessAudit(
  Effect.gen(function* () {
    const FRAMES = yield* Config.String('FRAMES').pipe(
      Config.withDefault('120'),
      Config.map(Number),
    )
    const WARM = yield* Config.String('WARM').pipe(
      Config.withDefault('2500'),
      Config.map(Number),
    )
    const scenarioName = yield* Config.String('SCENARIO').pipe(
      Config.withDefault('allRooms'),
    )
    const scenario = Option.fromUndefinedOr(SCENARIOS[scenarioName])
    if (Option.isNone(scenario)) {
      return yield* failWith(`unknown scenario ${scenarioName}`)
    }
    const browser = yield* openBrowser
    const page = yield* desktop(browser)
    yield* attempt(() => page.addInitScript({ content: COUNTER }))
    yield* attempt(() =>
      page.goto(harnessUrl(String.slice(1)(scenario.value.q))),
    )
    yield* sceneReady(page)
    yield* scenario.value.warm
    yield* wait(WARM)
    const rows = yield* decodedFrom(Schema.Array(PassRow), () =>
      page.evaluate(COUNT(FRAMES)),
    )
    const perFrame = (n: number) => (n / FRAMES).toFixed(2)
    const sorted = Array.sort(
      rows,
      Order.mapInput(
        Order.Number,
        (row: typeof PassRow.Type) => -row.pixels * row.passes,
      ),
    )
    yield* Console.log(
      `${scenarioName}, ${FRAMES} frames, per frame (size: passes, draws, clears, Mpx cleared)`,
    )
    yield* Effect.forEach(sorted, row =>
      Console.log(
        `${String.padStart(11)(row.size)}: ${perFrame(row.passes)} passes, ${perFrame(row.draws)} draws, ${perFrame(row.clears)} clears, ${((row.pixels * row.clears) / FRAMES / 1e6).toFixed(2)} Mpx`,
      ),
    )
    const total = Array.reduce(rows, { draws: 0, passes: 0 }, (sum, row) => ({
      draws: sum.draws + row.draws,
      passes: sum.passes + row.passes,
    }))
    yield* Console.log(
      `total: ${perFrame(total.passes)} passes, ${perFrame(total.draws)} draws`,
    )
  }),
)
