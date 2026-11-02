import { Effect, Schema } from 'effect'
import type { Browser, CDPSession, Page } from 'playwright-core'

import { Vector } from '@game/entitySchema'

import { canvasRect, desktop, modelAs, toClient, wait } from './lib'
import { evaluateAs } from './page'
import { SCENARIOS } from './scenarios'

export const FrameRow = Schema.Struct({
  scenario: Schema.String,
  rate: Schema.Number,
  frames: Schema.Number,
  fps: Schema.Number,
  median: Schema.Number,
  p95: Schema.Number,
  max: Schema.Number,
  dropped: Schema.Number,
  updateMean: Schema.Number,
  updateP95: Schema.Number,
  viewMean: Schema.Number,
  viewP95: Schema.Number,
  jsMs: Schema.Number,
  busyMs: Schema.Number,
  shapes: Schema.Number,
  zombies: Schema.String,
  particles: Schema.String,
  phase: Schema.String,
  decals: Schema.Number,
  // NOTE: optional, so rows recorded before they were measured still read.
  // Animation frames per second that drew, frame ticks per drawn frame, and
  // the share of frames with a tick that also drew in that frame.
  drawnFps: Schema.optionalKey(Schema.Number),
  ticksPerDraw: Schema.optionalKey(Schema.Number),
  drawnTickShare: Schema.optionalKey(Schema.Number),
  // NOTE: the calibration a row was recorded with, when it differs from the
  // baseline's own (a row recorded alone, perf-check.ts).
  calibrationMs: Schema.optionalKey(Schema.Number),
})
export type FrameRow = typeof FrameRow.Type

// NOTE: the fields of a Chrome trace event the audits read.
export const TraceEvent = Schema.Struct({
  name: Schema.String,
  ph: Schema.String,
  pid: Schema.Number,
  tid: Schema.Number,
  ts: Schema.Number,
  dur: Schema.optional(Schema.Number),
  args: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.Unknown) }),
  ),
})
export type TraceEvent = typeof TraceEvent.Type

// NOTE: collects the trace events of one `Tracing.start` to `Tracing.end`
// pass, listening before the pass starts. `done` resolves with them, decoded,
// once Chrome says the trace is complete.
export const collectTrace = (cdp: CDPSession) => {
  const raw: Array<unknown> = []
  cdp.on('Tracing.dataCollected', ({ value }) => {
    raw.push(...value)
  })
  const done = Effect.runPromise(
    Effect.callback<ReadonlyArray<TraceEvent>, Schema.SchemaError>(resume => {
      cdp.once('Tracing.tracingComplete', () =>
        resume(Schema.decodeUnknownEffect(Schema.Array(TraceEvent))(raw)),
      )
    }),
  )
  return { done }
}

const RunModel = Schema.Struct({
  zombies: Schema.Array(Schema.Unknown),
  particles: Schema.Array(Schema.Unknown),
  phase: Schema.Struct({ _tag: Schema.String }),
  decals: Schema.Array(Schema.Unknown),
})

const FrameData = Schema.Struct({
  deltas: Schema.Array(Schema.Number),
  elapsedMs: Schema.Number,
  update: Schema.Array(Schema.Number),
  view: Schema.Array(Schema.Number),
  viewFrames: Schema.Array(Schema.Number),
  tickFrames: Schema.Array(Schema.Number),
  shapes: Schema.Number,
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
  const drawnTicked = [...ticked].filter(frame => drawn.has(frame)).length
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
    mean: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length),
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
      const d = Math.hypot(z.x - m.player.x, z.y - m.player.y)
      if (d < bestDistance) {
        bestDistance = d
        best = z
      }
    }
    return best === undefined ? undefined : { x: best.x, y: best.y }
  })

const runBot = (page: Page, isDone: () => boolean) =>
  (async () => {
    const rect = await canvasRect(page)
    await page.mouse.move(640, 300)
    await page.mouse.down()
    while (!isDone()) {
      const target = await aimTarget(page)
      if (target !== undefined) {
        const point = toClient(rect, target.x, target.y)
        await page.mouse.move(point.x, point.y)
      }
      await wait(100)
    }
    await page.mouse.up()
  })()

const mainThreadBusyMs = (events: ReadonlyArray<TraceEvent>): number => {
  const main = events.find(
    e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
  )
  if (main === undefined) {
    return 0
  }
  const tasks = events
    .filter(
      e =>
        e.pid === main.pid &&
        e.tid === main.tid &&
        e.ph === 'X' &&
        e.name === 'ThreadControllerImpl::RunTask',
    )
    .sort((a, b) => a.ts - b.ts)
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

export const measureScenario = async (
  browser: Browser,
  base: string,
  name: string,
  rate: number,
  seconds: number,
): Promise<FrameRow> => {
  const scenario = SCENARIOS[name]
  if (scenario === undefined) {
    throw new Error(`unknown scenario ${name}`)
  }
  const page = await desktop(browser)
  const cdp = await page.context().newCDPSession(page)
  await page.goto(base + scenario.q + '&instrument')
  await wait(300)
  let isDone = false
  await scenario.warm()
  const bot = scenario.bot ? runBot(page, () => isDone) : Promise.resolve()
  if (scenario.bot) {
    await wait(1200)
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await wait(500)
  const m0 = await modelAs(page, RunModel)

  const trace = collectTrace(cdp)
  await cdp.send('Tracing.start', {
    categories: 'toplevel',
    transferMode: 'ReportEvents',
  })
  const data = await evaluateAs(
    page,
    FrameData,
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
  )
  await cdp.send('Tracing.end')
  const traceEvents = await trace.done

  const m1 = await modelAs(page, RunModel)
  isDone = true
  await bot
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.context().close()

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
    dropped: data.deltas.reduce(
      (n, d) => n + Math.max(0, Math.round(d / (1000 / 60)) - 1),
      0,
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
}

export const calibrationMs = async (browser: Browser): Promise<number> => {
  const page = await desktop(browser)
  await page.goto('about:blank')
  const times = await evaluateAs(page, Schema.Array(Schema.Number), () => {
    const run = () => {
      const t0 = performance.now()
      let checksum = 0
      for (let pass = 0; pass < 40; pass++) {
        const items = Array.from({ length: 20000 }, (_, i) => ({
          id: i,
          value: (i * 2654435761) % 1000003,
        }))
        items.sort((a, b) => a.value - b.value)
        checksum += items[pass]?.value ?? 0
      }
      return { ms: performance.now() - t0, checksum }
    }
    return Array.from({ length: 5 }, () => run().ms)
  })
  await page.context().close()
  const median = [...times].sort((a, b) => a - b)[2]
  if (median === undefined) {
    throw new Error('the calibration ran no passes')
  }
  return median
}
