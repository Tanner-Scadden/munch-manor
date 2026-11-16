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
  DESKTOP_1280,
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
// under each lit fill, the four fills on the view (3.53), so at most two
// maps are drawn a frame, the player's room's and one other in turn
// (src/render/iso/shadowBudget.ts): 1.97 when the budget came in.
const SHADOW_BUDGETS: Readonly<Record<string, number>> = {
  idle: 0.35,
  allRooms: 2.1,
}

// NOTE: a level-sized picture's pass (the ground's, the room's, the
// storm's, the puddles'): neither a shadow map nor the screen's own shape,
// which the screen and the bloom's halvings all keep (16:9 on the desktop
// page every scenario opens).
const SCREEN_SHAPE = 16 / 9

const isPicturePass = (row: PassRow): boolean =>
  !isShadowPass(row) && Math.abs(row.width / row.height - SCREEN_SHAPE) > 0.2

// NOTE: the most level-sized pictures each scenario may draw a frame,
// counted by their passes. Kept apart from SHADOW_BUDGETS. The ground's
// picture was drawn every frame, its shadows, bullets, and the kitchen's
// steam moving on it (1.30 a frame idle, 2.38 in a wave in every room); its
// rectangles are quads now and the picture is drawn only when the rest
// changes (src/render/iso/groundRects.ts): 0.31 and 1.50.
const PICTURE_BUDGETS: Readonly<Record<string, number>> = {
  idle: 0.45,
  allRooms: 1.8,
}

// NOTE: the bloom's levels are the screen's shape and smaller than it (the
// `desktop` page's); its combine draws at the screen's own size.
const isBloomPass = (row: PassRow): boolean =>
  !isShadowPass(row) && !isPicturePass(row) && row.width < DESKTOP_1280.width

// NOTE: the most bloom level passes each scenario may draw a frame. Its
// five halvings drew nine a frame (8.91), each a pass a phone's tiled GPU
// loads and stores whatever its size; three levels a quarter apart draw
// five (4.95, src/render/iso/bloom.ts).
const BLOOM_BUDGETS: Readonly<Record<string, number>> = {
  idle: 5.2,
  allRooms: 5.2,
}

// NOTE: the most render passes of any kind each scenario may draw a frame:
// 12.64 idle and 15.37 in a wave in every room before the cheaper bloom,
// 8.68 and 11.51 after.
const PASS_BUDGETS: Readonly<Record<string, number>> = {
  idle: 9.3,
  allRooms: 12.3,
}

const perFrameOf = (
  rows: ReadonlyArray<PassRow>,
  isCounted: (row: PassRow) => boolean,
  countOf: (row: PassRow) => number,
  frames: number,
): number =>
  Array.reduce(
    Array.filter(rows, isCounted),
    0,
    (sum, row) => sum + countOf(row),
  ) / frames

const overBudget = (
  input: Readonly<{
    budgets: Readonly<Record<string, number>>
    name: string
    count: number
    what: string
  }>,
): Option.Option<string> =>
  Option.flatMap(Option.fromUndefinedOr(input.budgets[input.name]), budget =>
    input.count > budget
      ? Option.some(
          `${input.name}: ${input.count.toFixed(2)} ${input.what} a frame, past ${budget}`,
        )
      : Option.none(),
  )

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
        const shadowMaps = perFrameOf(
          rows,
          isShadowPass,
          row => row.clears,
          frames,
        )
        const pictures = perFrameOf(
          rows,
          isPicturePass,
          row => row.passes,
          frames,
        )
        const bloomPasses = perFrameOf(
          rows,
          isBloomPass,
          row => row.passes,
          frames,
        )
        const passes = perFrameOf(
          rows,
          () => true,
          row => row.passes,
          frames,
        )
        yield* Console.log(
          `${name}: ${pictures.toFixed(2)} level-sized pictures, ${bloomPasses.toFixed(2)} bloom level passes drawn a frame\n`,
        )
        return [
          overBudget({
            budgets: SHADOW_BUDGETS,
            name,
            count: shadowMaps,
            what: 'shadow maps drawn',
          }),
          overBudget({
            budgets: PICTURE_BUDGETS,
            name,
            count: pictures,
            what: 'level-sized pictures drawn',
          }),
          overBudget({
            budgets: BLOOM_BUDGETS,
            name,
            count: bloomPasses,
            what: 'bloom level passes drawn',
          }),
          overBudget({
            budgets: PASS_BUDGETS,
            name,
            count: passes,
            what: 'render passes drawn',
          }),
        ]
      }),
    )
    const failures = Array.getSomes(Array.flatten(over))
    if (failures.length > 0) {
      return yield* failWith(
        `GPU work over budget: ${Array.join(failures, '; ')}`,
      )
    }
    yield* Console.log('GPU work within budget')
  }),
)
