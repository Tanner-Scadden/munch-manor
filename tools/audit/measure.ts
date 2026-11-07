import {
  Array,
  Deferred,
  Effect,
  Fiber,
  Function,
  Option,
  Schema,
} from 'effect'
import type { Browser, CDPSession, Page } from 'playwright-core'

import { Vector } from '@game/entitySchema'

import { canvasRect, closePage, desktop, modelAs, toClient, wait } from './lib'
import {
  type AuditFailed,
  attempt,
  decodedFrom,
  evaluateAs,
  failWith,
} from './page'
import { SCENARIOS } from './scenarios'

export const FrameRow = Schema.Struct({
  scenario: Schema.String,
  rate: Schema.Finite,
  frames: Schema.Finite,
  fps: Schema.Finite,
  median: Schema.Finite,
  p95: Schema.Finite,
  max: Schema.Finite,
  dropped: Schema.Finite,
  updateMean: Schema.Finite,
  updateP95: Schema.Finite,
  viewMean: Schema.Finite,
  viewP95: Schema.Finite,
  jsMs: Schema.Finite,
  busyMs: Schema.Finite,
  shapes: Schema.Finite,
  zombies: Schema.String,
  particles: Schema.String,
  phase: Schema.String,
  decals: Schema.Finite,
  // NOTE: optional, so rows recorded before they were measured still read.
  // Animation frames per second that drew, frame ticks per drawn frame, and
  // the share of frames with a tick that also drew in that frame.
  drawnFps: Schema.optionalKey(Schema.Finite),
  ticksPerDraw: Schema.optionalKey(Schema.Finite),
  drawnTickShare: Schema.optionalKey(Schema.Finite),
  // NOTE: the calibration a row was recorded with, when it differs from the
  // baseline's own (a row recorded alone, perf-check.ts).
  calibrationMs: Schema.optionalKey(Schema.Finite),
})
export type FrameRow = typeof FrameRow.Type

// NOTE: the fields of a Chrome trace event the audits read.
export const TraceEvent = Schema.Struct({
  name: Schema.String,
  ph: Schema.String,
  pid: Schema.Finite,
  tid: Schema.Finite,
  ts: Schema.Finite,
  dur: Schema.optional(Schema.Finite),
  args: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.Unknown) }),
  ),
})
export type TraceEvent = typeof TraceEvent.Type

// NOTE: collects the trace events of one `Tracing.start` to `Tracing.end`
// pass, listening before the pass starts. `done` waits for them, decoded,
// once Chrome says the trace is complete.
export const collectTrace = (cdp: CDPSession) => {
  const raw: Array<unknown> = []
  cdp.on('Tracing.dataCollected', ({ value }) => {
    raw.push(...value)
  })
  const complete = Deferred.makeUnsafe<
    ReadonlyArray<TraceEvent>,
    Schema.SchemaError
  >()
  cdp.once('Tracing.tracingComplete', () => {
    Deferred.doneUnsafe(
      complete,
      Schema.decodeUnknownEffect(Schema.Array(TraceEvent))(raw),
    )
  })
  return { done: Deferred.await(complete) }
}

const RunModel = Schema.Struct({
  zombies: Schema.Array(Schema.Unknown),
  particles: Schema.Array(Schema.Unknown),
  phase: Schema.Struct({ _tag: Schema.String }),
  decals: Schema.Array(Schema.Unknown),
})

const FrameData = Schema.Struct({
  deltas: Schema.Array(Schema.Finite),
  elapsedMs: Schema.Finite,
  update: Schema.Array(Schema.Finite),
  view: Schema.Array(Schema.Finite),
  viewFrames: Schema.Array(Schema.Finite),
  tickFrames: Schema.Array(Schema.Finite),
  shapes: Schema.Finite,
})

// NOTE: how the frames that ticked were drawn: the frames that drew, frame
// ticks per drawn frame, and the share of ticked frames that drew in the
// same animation frame. A render a frame late shows as ticks per draw near
// 2 and a share near half.
const cadenceOf = (
  viewFrames: ReadonlyArray<number>,
  tickFrames: ReadonlyArray<number>,
) => {
  const drawn = new Set(viewFrames)
  const ticked = new Set(tickFrames)
  const drawnTicked = Array.filter([...ticked], frame =>
    drawn.has(frame),
  ).length
  return {
    drawnFrames: drawn.size,
    ticksPerDraw: drawn.size === 0 ? 0 : tickFrames.length / drawn.size,
    drawnTickShare: ticked.size === 0 ? 1 : drawnTicked / ticked.size,
  }
}

const stats = (xs: ReadonlyArray<number>) => {
  const s = [...xs].sort((a, b) => a - b)
  const q = (f: number) =>
    s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0
  return {
    median: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1] ?? 0,
    mean: Array.reduce(xs, 0, (a, b) => a + b) / Math.max(1, xs.length),
  }
}

const round = (value: number, digits: number) => +value.toFixed(digits)

// NOTE: the nearest zombie still standing, found in the page so the bot
// reads two numbers each step instead of the whole Model.
const aimTarget = (page: Page) =>
  evaluateAs(page, Schema.UndefinedOr(Vector), () => {
    const m = window.__model
    let best: { x: number; y: number } | undefined
    let bestDistance = Infinity
    for (const z of m.zombies) {
      if (z.state._tag === 'Dying') {
        continue
      }
      const d = Math.hypot(z.x - m.seats[0].player.x, z.y - m.seats[0].player.y)
      if (d < bestDistance) {
        bestDistance = d
        best = z
      }
    }
    return best === undefined ? undefined : { x: best.x, y: best.y }
  })

const runBot = (page: Page, isDone: () => boolean) =>
  Effect.gen(function* () {
    const rect = yield* canvasRect(page)
    yield* attempt(() => page.mouse.move(640, 300))
    yield* attempt(() => page.mouse.down())
    while (!isDone()) {
      const target = yield* aimTarget(page)
      if (target !== undefined) {
        const point = toClient(rect, target.x, target.y)
        yield* attempt(() => page.mouse.move(point.x, point.y))
      }
      yield* wait(100)
    }
    yield* attempt(() => page.mouse.up())
  })

const mainThreadBusyMs = (events: ReadonlyArray<TraceEvent>): number => {
  const maybeMain = Array.findFirst(
    events,
    e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
  )
  if (Option.isNone(maybeMain)) {
    return 0
  }
  const main = maybeMain.value
  const tasks = Array.filter(
    events,
    e =>
      e.pid === main.pid &&
      e.tid === main.tid &&
      e.ph === 'X' &&
      e.name === 'ThreadControllerImpl::RunTask',
  ).sort((a, b) => a.ts - b.ts)
  let busyUntil = -Infinity
  let busy = 0
  for (const task of tasks) {
    const end = task.ts + (task.dur ?? 0)
    if (end > busyUntil) {
      busy += end - Math.max(task.ts, busyUntil)
      busyUntil = end
    }
  }
  return busy / 1000
}

type Measured = Effect.Effect<FrameRow, AuditFailed | Schema.SchemaError>

export const measureScenario: {
  (
    base: string,
    name: string,
    rate: number,
    seconds: number,
  ): (browser: Browser) => Measured
  (
    browser: Browser,
    base: string,
    name: string,
    rate: number,
    seconds: number,
  ): Measured
} = Function.dual(
  5,
  (
    browser: Browser,
    base: string,
    name: string,
    rate: number,
    seconds: number,
  ): Measured =>
    Effect.gen(function* () {
      const scenario = SCENARIOS[name]
      if (scenario === undefined) {
        return yield* failWith(`unknown scenario ${name}`)
      }
      const page = yield* desktop(browser)
      const cdp = yield* attempt(() => page.context().newCDPSession(page))
      yield* attempt(() => page.goto(base + scenario.q + '&instrument'))
      yield* wait(300)
      let isDone = false
      yield* scenario.warm
      const bot = yield* Effect.forkChild(
        scenario.bot ? runBot(page, () => isDone) : Effect.void,
        { startImmediately: true },
      )
      if (scenario.bot) {
        yield* wait(1200)
      }
      yield* attempt(() => cdp.send('Emulation.setCPUThrottlingRate', { rate }))
      yield* wait(500)
      const m0 = yield* modelAs(page, RunModel)

      const trace = collectTrace(cdp)
      yield* attempt(() =>
        cdp.send('Tracing.start', {
          categories: 'toplevel',
          transferMode: 'ReportEvents',
        }),
      )
      const data = yield* decodedFrom(FrameData, () =>
        page.evaluate(
          // NOTE: runs in the page, where frames are waited on by a promise.
          // @effect-diagnostics-next-line asyncFunction:off
          async (durationSeconds: number) => {
            window.__timings.update.length = 0
            window.__timings.view.length = 0
            window.__timings.viewFrames.length = 0
            window.__timings.tickFrames.length = 0
            const deltas: Array<number> = []
            const start = performance.now()
            let last = start
            // NOTE: runs in the page: it waits on the browser's own frames, which
            // only `requestAnimationFrame` gives.
            // @effect-diagnostics-next-line newPromise:off
            await new Promise<void>(resolve => {
              const end = last + durationSeconds * 1000
              const tick = (t: number) => {
                deltas.push(t - last)
                last = t
                if (t < end) {
                  requestAnimationFrame(tick)
                } else {
                  resolve()
                }
              }
              requestAnimationFrame(tick)
            })
            return {
              deltas,
              elapsedMs: last - start,
              update: [...window.__timings.update],
              view: [...window.__timings.view],
              viewFrames: [...window.__timings.viewFrames],
              tickFrames: [...window.__timings.tickFrames],
              shapes: window.__countShapes(),
            }
          },
          seconds,
        ),
      )
      yield* attempt(() => cdp.send('Tracing.end'))
      const traceEvents = yield* trace.done

      const m1 = yield* modelAs(page, RunModel)
      isDone = true
      yield* Fiber.join(bot)
      yield* attempt(() =>
        cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }),
      )
      yield* closePage(page)

      const frame = stats(data.deltas)
      const update = stats(data.update)
      const view = stats(data.view)
      const cadence = cadenceOf(data.viewFrames, data.tickFrames)
      return {
        scenario: name,
        rate,
        frames: data.deltas.length,
        fps: round((1000 * data.deltas.length) / data.elapsedMs, 1),
        median: round(frame.median, 1),
        p95: round(frame.p95, 1),
        max: round(frame.max, 1),
        dropped: Array.reduce(
          data.deltas,
          0,
          (n, d) => n + Math.max(0, Math.round(d / (1000 / 60)) - 1),
        ),
        updateMean: round(update.mean, 2),
        updateP95: round(update.p95, 2),
        viewMean: round(view.mean, 2),
        viewP95: round(view.p95, 2),
        jsMs: round(update.mean + view.mean, 2),
        busyMs: round(mainThreadBusyMs(traceEvents) / data.deltas.length, 2),
        shapes: data.shapes,
        zombies: `${m0.zombies.length}->${m1.zombies.length}`,
        particles: `${m0.particles.length}->${m1.particles.length}`,
        phase: m1.phase._tag,
        decals: m1.decals.length,
        drawnFps: round((1000 * cadence.drawnFrames) / data.elapsedMs, 1),
        ticksPerDraw: round(cadence.ticksPerDraw, 2),
        drawnTickShare: round(cadence.drawnTickShare, 2),
      }
    }),
)

export const calibrationMs = (browser: Browser) =>
  Effect.gen(function* () {
    const page = yield* desktop(browser)
    yield* attempt(() => page.goto('about:blank'))
    const times = yield* evaluateAs(page, Schema.Array(Schema.Finite), () => {
      const run = () => {
        const t0 = performance.now()
        let checksum = 0
        for (let pass = 0; pass < 40; pass++) {
          const items = globalThis.Array.from({ length: 20000 }, (_, i) => ({
            id: i,
            value: (i * 2654435761) % 1000003,
          }))
          items.sort((a, b) => a.value - b.value)
          checksum += items[pass]?.value ?? 0
        }
        return { ms: performance.now() - t0, checksum }
      }
      return globalThis.Array.from({ length: 5 }, () => run().ms)
    })
    yield* closePage(page)
    const median = [...times].sort((a, b) => a - b)[2]
    if (median === undefined) {
      return yield* failWith('the calibration ran no passes')
    }
    return median
  })
