import {
  Array,
  Config,
  Console,
  Effect,
  Fiber,
  Option,
  Schema,
  String,
} from 'effect'

import { encodeJson } from '../json'
import {
  AimView,
  canvasRect,
  desktop,
  modelAs,
  nearestZombie,
  openBrowser,
  runAudit,
  toClient,
  wait,
} from './lib'
import { type TraceEvent, collectTrace } from './measure'
import { attempt, failWith } from './page'
import { SCENARIOS } from './scenarios'

runAudit(
  Effect.gen(function* () {
    const RATE = yield* Config.String('RATE').pipe(
      Config.withDefault('4'),
      Config.map(Number),
    )
    const MS = yield* Config.String('MS').pipe(
      Config.withDefault('2000'),
      Config.map(Number),
    )
    const BASE = yield* Config.String('BASE').pipe(
      Config.withDefault('http://localhost:4175/'),
    )
    const SCENARIO = yield* Config.String('SCENARIO').pipe(
      Config.withDefault('worst'),
    )
    const scenario = SCENARIOS[SCENARIO]
    if (scenario === undefined) {
      return yield* failWith(`unknown scenario ${SCENARIO}`)
    }

    const browser = yield* openBrowser
    const page = yield* desktop(browser)
    const cdp = yield* attempt(() => page.context().newCDPSession(page))
    yield* attempt(() => page.goto(BASE + scenario.q))
    yield* scenario.warm
    const botState = { isDone: false }
    const bot = yield* Effect.forkChild(
      Effect.gen(function* () {
        if (!scenario.bot) {
          return
        }
        const rect = yield* canvasRect(page)
        yield* attempt(() => page.mouse.move(640, 300))
        yield* attempt(() => page.mouse.down())
        while (!botState.isDone) {
          const m = yield* modelAs(page, AimView)
          const z = nearestZombie(m)
          if (z !== undefined) {
            const c = toClient(rect, z.x, z.y)
            yield* attempt(() => page.mouse.move(c.x, c.y))
          }
          yield* wait(100)
        }
        yield* attempt(() => page.mouse.up())
      }),
      { startImmediately: true },
    )
    yield* wait(1200)
    yield* attempt(() =>
      cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE }),
    )
    yield* wait(300)

    const trace = collectTrace(cdp)
    yield* attempt(() =>
      cdp.send('Tracing.start', {
        categories:
          'devtools.timeline,v8,v8.execute,disabled-by-default-devtools.timeline,blink.user_timing',
        transferMode: 'ReportEvents',
      }),
    )
    yield* wait(MS)
    yield* attempt(() => cdp.send('Tracing.end'))
    const traceEvents = yield* trace.done

    yield* attempt(() => cdp.send('Profiler.enable'))
    yield* attempt(() =>
      cdp.send('Profiler.setSamplingInterval', { interval: 100 }),
    )
    yield* attempt(() => cdp.send('Profiler.start'))
    yield* wait(MS)
    const { profile } = yield* attempt(() => cdp.send('Profiler.stop'))
    botState.isDone = true
    yield* Fiber.join(bot)
    yield* attempt(() => browser.close())
    const dump = yield* Config.String('DUMP').pipe(Config.withDefault(''))
    if (dump !== '') {
      const text = encodeJson(Schema.Unknown)(profile)
      yield* attempt(() => Bun.write(dump, text))
    }

    yield* Console.log(`scenario ${SCENARIO} at ${RATE}x, ${MS}ms per pass`)

    // TRACE: main thread time by top-level event kind

    type TimedEvent = TraceEvent & Readonly<{ dur: number }>
    const isTimed = (e: TraceEvent): e is TimedEvent =>
      e.ph === 'X' && e.dur !== undefined

    const mainThread = Array.findFirst(
      traceEvents,
      e => e.name === 'thread_name' && e.args?.name === 'CrRendererMain',
    )
    const onMain = Option.match(mainThread, {
      onNone: (): ReadonlyArray<TraceEvent> => [],
      onSome: main =>
        Array.filter(
          traceEvents,
          e => e.pid === main.pid && e.tid === main.tid,
        ),
    })
    const topLevel = (() => {
      const sorted = Array.filter(onMain, isTimed).sort(
        (first, second) => first.ts - second.ts || second.dur - first.dur,
      )
      const out: Array<TimedEvent> = []
      const stack: Array<TimedEvent> = []
      for (const e of sorted) {
        for (
          let top = stack.at(-1);
          top !== undefined && e.ts >= top.ts + top.dur;
          top = stack.at(-1)
        ) {
          stack.pop()
        }
        const depthUnderTask = Array.filter(
          stack,
          s => s.name !== 'RunTask',
        ).length
        if (depthUnderTask === 0 && e.name !== 'RunTask') {
          out.push(e)
        }
        stack.push(e)
      }
      return out
    })()
    const sumByName = (names: ReadonlyArray<string>) =>
      Array.reduce(
        Array.filter(topLevel, e => names.includes(e.name)),
        0,
        (sum, e) => sum + e.dur / 1000,
      )
    const topNames = new Map<string, number>()
    for (const e of topLevel) {
      topNames.set(e.name, (topNames.get(e.name) ?? 0) + e.dur / 1000)
    }
    const traceRows: Array<[string, ReadonlyArray<string>]> = [
      ['rAF callbacks (all JS in frame)', ['FireAnimationFrame']],
      [
        'other JS (events, timers, bot)',
        ['FunctionCall', 'EvaluateScript', 'TimerFire', 'EventDispatch'],
      ],
      [
        'GC (minor + major)',
        [
          'MinorGC',
          'MajorGC',
          'V8.GC_SCAVENGER',
          'V8.GC_MARK_COMPACTOR',
          'BlinkGC.AtomicPhase',
        ],
      ],
      ['style + layout', ['UpdateLayoutTree', 'Layout']],
      ['paint + prepaint', ['Paint', 'PrePaint', 'PaintImage']],
      [
        'layerize + commit',
        ['Layerize', 'Commit', 'UpdateLayer', 'CompositeLayers'],
      ],
    ]
    yield* Console.log('--- main thread trace (ms over the pass)')
    for (const [label, names] of traceRows) {
      yield* Console.log(
        String.padStart(6)(sumByName(names).toFixed(0)) + 'ms',
        label,
      )
    }
    yield* Console.log('--- top-level main thread events')
    for (const [name, t] of [...topNames]
      .sort((first, second) => second[1] - first[1])
      .slice(0, 10)) {
      yield* Console.log(String.padStart(6)(t.toFixed(0)) + 'ms', name)
    }
    const frames = Array.filter(topLevel, e => e.name === 'FireAnimationFrame')
    yield* Console.log(
      `rAF callbacks: ${frames.length}, mean ${(sumByName(['FireAnimationFrame']) / Math.max(1, frames.length)).toFixed(2)}ms`,
    )

    // CPU PROFILE: self time bucketed by the nearest named ancestor

    type ProfileNode = (typeof profile.nodes)[number]
    const nodes = new Map(Array.map(profile.nodes, n => [n.id, n]))
    const nodeOf = (id: number) => {
      const node = nodes.get(id)
      return node === undefined
        ? Effect.fail(failWith(`the CPU profile has no node ${id}`))
        : Effect.succeed(node)
    }
    const parent = new Map<number, number>()
    for (const n of profile.nodes) {
      for (const c of n.children ?? []) {
        parent.set(c, n.id)
      }
    }
    const timeDeltas = profile.timeDeltas ?? []
    const dt = new Map<number, number>()
    Array.forEach(profile.samples ?? [], (id, i) =>
      dt.set(id, (dt.get(id) ?? 0) + (timeDeltas[i] ?? 0) / 1000),
    )
    const total = Array.reduce([...dt.values()], 0, (sum, t) => sum + t)
    const label = (n: ProfileNode) =>
      `${n.callFrame.functionName === '' ? '(anon)' : n.callFrame.functionName} ${String.split('/')(n.callFrame.url).pop() ?? ''}:${n.callFrame.lineNumber + 1}`
    const self = new Map<string, number>()
    for (const [id, t] of dt) {
      const node = yield* nodeOf(id)
      const l = label(node)
      self.set(l, (self.get(l) ?? 0) + t)
    }
    yield* Console.log('--- top self')
    for (const [l, t] of [...self]
      .sort((first, second) => second[1] - first[1])
      .slice(0, 25)) {
      yield* Console.log(
        String.padStart(5)(((100 * t) / total).toFixed(1)) + '%',
        l,
      )
    }

    const named = (name: string) => (n: ProfileNode) =>
      n.callFrame.functionName === name
    const buckets: Array<[string, (n: ProfileNode) => boolean]> = [
      ['paint (Foldkit paintScene)', named('paintScene')],
      ['scene build (sceneShapes)', named('sceneShapes')],
      ['update (harnessUpdate)', named('harnessUpdate')],
      ['snabbdom patch, minus paint', named('patch')],
      [
        'audit bot serialize',
        n => ['serialize', 'innerSerialize'].includes(n.callFrame.functionName),
      ],
      ['(garbage collector)', named('(garbage collector)')],
      ['(program) native, outside JS', named('(program)')],
      ['(idle)', named('(idle)')],
    ]
    const bucketTotals = new Map<string, number>()
    const otherSelf = new Map<string, number>()
    for (const [id, t] of dt) {
      let cur: number | undefined = id
      let bucket = 'other JS (view vdom build, runtime, Effect)'
      while (cur !== undefined) {
        const node = yield* nodeOf(cur)
        const hit = Array.findFirst(buckets, ([, pred]) => pred(node))
        if (Option.isSome(hit)) {
          bucket = hit.value[0]
          break
        }
        cur = parent.get(cur)
      }
      bucketTotals.set(bucket, (bucketTotals.get(bucket) ?? 0) + t)
      if (String.startsWith('other')(bucket)) {
        const otherNode = yield* nodeOf(id)
        const l = label(otherNode)
        otherSelf.set(l, (otherSelf.get(l) ?? 0) + t)
      }
    }
    yield* Console.log(
      `--- CPU profile, nearest-bucket breakdown (total ${total.toFixed(0)}ms)`,
    )
    for (const [name, t] of [...bucketTotals].sort(
      (first, second) => second[1] - first[1],
    )) {
      yield* Console.log(
        String.padStart(5)(((100 * t) / total).toFixed(1)) + '%',
        name,
        t.toFixed(0) + 'ms',
      )
    }

    yield* Console.log('--- top self inside other JS')
    for (const [l, t] of [...otherSelf]
      .sort((first, second) => second[1] - first[1])
      .slice(0, 12)) {
      yield* Console.log(String.padStart(6)(t.toFixed(0)) + 'ms', l)
    }

    const focusText = yield* Config.String('FOCUS').pipe(Config.option)
    const FOCUS = Option.match(focusText, {
      onNone: (): ReadonlyArray<string> => [],
      onSome: String.split(','),
    })
    for (const focus of FOCUS) {
      const chains = new Map<string, number>()
      for (const [id, t] of dt) {
        let cur: number | undefined = id
        const names: Array<string> = []
        let hit = false
        while (cur !== undefined) {
          const focusNode = yield* nodeOf(cur)
          const c = focusNode.callFrame
          if (c.functionName === focus) {
            hit = true
          }
          if (c.functionName !== '') {
            names.push(c.functionName)
          }
          cur = parent.get(cur)
        }
        if (!hit) {
          continue
        }
        const key = Array.join(names.slice(0, 8), ' < ')
        chains.set(key, (chains.get(key) ?? 0) + t)
      }
      yield* Console.log(`--- stacks through ${focus}`)
      for (const [k, t] of [...chains]
        .sort((first, second) => second[1] - first[1])
        .slice(0, 10)) {
        yield* Console.log(t.toFixed(0) + 'ms', k)
      }
    }
  }),
)
