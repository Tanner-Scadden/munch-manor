import { Array, Config, Console, Effect, Option, Schema, String } from 'effect'

import { encodeJson } from '../json'
import { runHarnessAudit } from './harnessServer'
import { desktop, harnessUrl, openBrowser, sceneReady, wait } from './lib'
import { type TraceEvent, collectTrace } from './measure'
import { attempt, evaluateAs, failWith } from './page'
import { SCENARIOS } from './scenarios'

runHarnessAudit(
  Effect.gen(function* () {
    const RATE = yield* Config.String('RATE').pipe(
      Config.withDefault('4'),
      Config.map(Number),
    )
    const MS = yield* Config.String('MS').pipe(
      Config.withDefault('4000'),
      Config.map(Number),
    )
    const WARM = yield* Config.String('WARM').pipe(
      Config.withDefault('1500'),
      Config.map(Number),
    )
    const TOP = yield* Config.String('TOP').pipe(
      Config.withDefault('8'),
      Config.map(Number),
    )
    const query = yield* Config.String('Q').pipe(Config.option)
    const scenarioName = yield* Config.String('SCENARIO').pipe(
      Config.withDefault('gasbags'),
    )
    const scenarioQuery = Option.match(query, {
      onSome: (q): Option.Option<string> => Option.some(q),
      onNone: () =>
        Option.map(Option.fromUndefinedOr(SCENARIOS[scenarioName]), ({ q }) =>
          String.slice(1)(q),
        ),
    })
    if (Option.isNone(scenarioQuery)) {
      return yield* failWith(`unknown scenario ${scenarioName}`)
    }

    const browser = yield* openBrowser
    const page = yield* desktop(browser)
    const cdp = yield* attempt(() => page.context().newCDPSession(page))
    yield* attempt(() => page.goto(harnessUrl(scenarioQuery.value)))
    yield* sceneReady(page)
    yield* wait(WARM)
    yield* attempt(() =>
      cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE }),
    )
    yield* wait(300)

    const trace = collectTrace(cdp)
    yield* attempt(() => cdp.send('Profiler.enable'))
    yield* attempt(() =>
      cdp.send('Profiler.setSamplingInterval', { interval: 100 }),
    )
    yield* attempt(() =>
      cdp.send('Tracing.start', {
        categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
        transferMode: 'ReportEvents',
      }),
    )
    yield* attempt(() => cdp.send('Profiler.start'))
    yield* attempt(() =>
      page.evaluate(() => {
        const stamps: Array<number> = []
        window.__frameStamps = stamps
        const record = (time: number) => {
          if (window.__frameStamps === stamps) {
            stamps.push(time)
            requestAnimationFrame(record)
          }
        }
        requestAnimationFrame(record)
      }),
    )
    yield* wait(MS)
    const { profile } = yield* attempt(() => cdp.send('Profiler.stop'))
    const dump = yield* Config.String('DUMP').pipe(Config.withDefault(''))
    if (dump !== '') {
      const text = encodeJson(Schema.Unknown)(profile)
      yield* attempt(() => Bun.write(dump, text))
    }
    yield* attempt(() =>
      page.evaluate(() => {
        window.__frameStamps = [...(window.__frameStamps ?? [])]
      }),
    )
    yield* attempt(() => cdp.send('Tracing.end'))
    const traceEvents = yield* trace.done

    type TimedEvent = TraceEvent & Readonly<{ dur: number }>
    const isTimed = (e: TraceEvent): e is TimedEvent =>
      e.ph === 'X' && e.dur !== undefined
    const mainThread = Array.findFirst(
      traceEvents,
      e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
    )
    if (Option.isNone(mainThread)) {
      return yield* failWith('the trace has no main thread')
    }
    const main = mainThread.value
    const frames = Array.filter(
      traceEvents,
      (e): e is TimedEvent =>
        isTimed(e) &&
        e.pid === main.pid &&
        e.tid === main.tid &&
        e.name === 'FireAnimationFrame',
    )
    const byLength = [...frames].sort((a, b) => b.dur - a.dur)
    const msOf = (us: number) => (us / 1000).toFixed(1)
    const durationAt = (share: number) =>
      [...frames].sort((a, b) => a.dur - b.dur)[
        Math.min(frames.length - 1, Math.floor(share * frames.length))
      ]?.dur ?? 0
    const firstTs = Option.match(Array.head(frames), {
      onNone: () => 0,
      onSome: ({ ts }) => ts,
    })
    yield* Console.log(
      `${scenarioQuery.value} at ${RATE}x over ${MS}ms: ${frames.length} frames, p50 ${msOf(durationAt(0.5))}ms, p95 ${msOf(durationAt(0.95))}ms, p99 ${msOf(durationAt(0.99))}ms, max ${msOf(byLength[0]?.dur ?? 0)}ms`,
    )
    const stamps = yield* evaluateAs(
      page,
      Schema.Array(Schema.Finite),
      () => window.__frameStamps ?? [],
    )
    const traceStart = Option.match(Array.head(stamps), {
      onNone: () => 0,
      onSome: first => first,
    })
    const gaps: Array<Readonly<{ at: number; gap: number }>> = []
    for (let i = 1; i < stamps.length; i++) {
      const before = stamps[i - 1] ?? 0
      gaps.push({ at: before - traceStart, gap: (stamps[i] ?? 0) - before })
    }
    const sortedGaps = [...gaps].sort((a, b) => a.gap - b.gap)
    const gapAt = (share: number) =>
      sortedGaps[
        Math.min(sortedGaps.length - 1, Math.floor(share * sortedGaps.length))
      ]?.gap ?? 0
    const slowGaps = Array.filter(gaps, ({ gap }) => gap > 20)
    yield* Console.log(
      `display frames ${stamps.length} (${((1000 * stamps.length) / MS).toFixed(0)} fps), gap p50 ${gapAt(0.5).toFixed(1)}ms p99 ${gapAt(0.99).toFixed(1)}ms, over 20ms: ${slowGaps.length}: ${Array.join(
        Array.map(
          Array.take(
            [...slowGaps].sort((a, b) => b.gap - a.gap),
            12,
          ),
          ({ at, gap }) => `${gap.toFixed(1)}ms at +${at.toFixed(0)}`,
        ),
        ', ',
      )}`,
    )

    const nodes = new Map(Array.map(profile.nodes, n => [n.id, n]))
    const parent = new Map<number, number>()
    for (const n of profile.nodes) {
      for (const c of n.children ?? []) {
        parent.set(c, n.id)
      }
    }
    const labelOf = (id: number) => {
      const node = nodes.get(id)
      if (node === undefined) {
        return '?'
      }
      const { functionName, url, lineNumber } = node.callFrame
      const file = Option.getOrElse(
        Array.last(String.split('/')(url)),
        () => '',
      )
      return `${functionName === '' ? '(anon)' : functionName} ${file}:${lineNumber + 1}`
    }
    const deltas = profile.timeDeltas ?? []
    const samples = profile.samples ?? []
    const times: Array<number> = []
    let now = profile.startTime
    for (const delta of deltas) {
      now += delta
      times.push(now)
    }
    const worst = TOP === 0 ? byLength : Array.take(byLength, TOP)
    const ROWS = yield* Config.String('ROWS').pipe(
      Config.withDefault('45'),
      Config.map(Number),
    )
    const unders = yield* Config.String('UNDER').pipe(
      Config.withDefault(''),
      Config.map(text =>
        Array.filter(String.split(',')(text), name => name !== ''),
      ),
    )
    const ABOVE_DEPTH = 3
    const aboves = yield* Config.String('ABOVE').pipe(
      Config.withDefault(''),
      Config.map(text =>
        Array.filter(String.split(',')(text), name => name !== ''),
      ),
    )
    const isPer = yield* Config.String('PER').pipe(
      Config.withDefault(''),
      Config.map(per => per === '1'),
    )
    const groups = isPer ? Array.map(worst, frame => [frame]) : [worst]
    const isInGroup = (group: ReadonlyArray<TimedEvent>, t: number) =>
      Array.some(group, frame => t >= frame.ts && t <= frame.ts + frame.dur)
    for (const group of groups) {
      const self = new Map<string, number>()
      const inclusive = new Map<string, number>()
      const belows = Array.map(unders, () => new Map<string, number>())
      const callers = Array.map(aboves, () => new Map<string, number>())
      let count = 0
      for (let i = 0; i < samples.length; i++) {
        const t = times[i] ?? 0
        const id = samples[i]
        if (id === undefined || !isInGroup(group, t)) {
          continue
        }
        count++
        const ms = (deltas[i + 1] ?? 0) / 1000
        const label = labelOf(id)
        self.set(label, (self.get(label) ?? 0) + ms)
        const seen = new Set<string>()
        const callerLabels: Array<string | undefined> = Array.map(
          aboves,
          () => undefined,
        )
        const callersLeft: Array<number> = Array.map(aboves, () => 0)
        let child = label
        const belowLabels: Array<string | undefined> = Array.map(
          unders,
          () => undefined,
        )
        for (
          let current: number | undefined = id;
          current !== undefined;
          current = parent.get(current)
        ) {
          const name = labelOf(current)
          if (!seen.has(name)) {
            seen.add(name)
            inclusive.set(name, (inclusive.get(name) ?? 0) + ms)
          }
          for (let a = 0; a < aboves.length; a++) {
            if (
              current !== id &&
              child === label &&
              String.startsWith(aboves[a] ?? '')(label)
            ) {
              callerLabels[a] = name
              callersLeft[a] = ABOVE_DEPTH - 1
            } else if ((callersLeft[a] ?? 0) > 0) {
              callerLabels[a] = `${callerLabels[a] ?? ''} < ${name}`
              callersLeft[a] = (callersLeft[a] ?? 0) - 1
            }
          }
          for (let u = 0; u < unders.length; u++) {
            if (String.startsWith(unders[u] ?? '')(name)) {
              belowLabels[u] = current === id ? '(self)' : child
            }
          }
          child = name
        }
        Array.forEach(callerLabels, (callerLabel, a) => {
          const above = callers[a]
          if (callerLabel !== undefined && above !== undefined) {
            above.set(callerLabel, (above.get(callerLabel) ?? 0) + ms)
          }
        })
        Array.forEach(belowLabels, (belowLabel, u) => {
          const below = belows[u]
          if (belowLabel !== undefined && below !== undefined) {
            below.set(belowLabel, (below.get(belowLabel) ?? 0) + ms)
          }
        })
      }
      const total = Array.reduce(group, 0, (sum, { dur }) => sum + dur)
      yield* Console.log(
        `\n=== ${group.length} frames from +${msOf(Math.min(...Array.map(group, ({ ts }) => ts)) - firstTs)}ms took ${msOf(total)}ms (${count} samples)`,
      )
      const top = (table: Map<string, number>, n: number) =>
        Array.take(
          [...table].sort((a, b) => b[1] - a[1]),
          n,
        )
      yield* Console.log('--- self')
      for (const [name, ms] of top(self, Math.max(20, ROWS / 2))) {
        yield* Console.log(String.padStart(7)(ms.toFixed(2)) + 'ms', name)
      }
      yield* Console.log('--- inclusive')
      for (const [name, ms] of top(inclusive, ROWS)) {
        yield* Console.log(String.padStart(7)(ms.toFixed(2)) + 'ms', name)
      }
      for (let a = 0; a < aboves.length; a++) {
        yield* Console.log(`--- above ${aboves[a] ?? ''}`)
        for (const [name, ms] of top(
          callers[a] ?? new Map<string, number>(),
          ROWS,
        )) {
          yield* Console.log(String.padStart(7)(ms.toFixed(2)) + 'ms', name)
        }
      }
      for (let u = 0; u < unders.length; u++) {
        yield* Console.log(`--- under ${unders[u] ?? ''}`)
        for (const [name, ms] of top(
          belows[u] ?? new Map<string, number>(),
          ROWS,
        )) {
          yield* Console.log(String.padStart(7)(ms.toFixed(2)) + 'ms', name)
        }
      }
    }
  }),
)
