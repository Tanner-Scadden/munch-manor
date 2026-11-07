import { type Subprocess, spawn } from 'bun'
import {
  Array,
  Config,
  Console,
  DateTime,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  String,
} from 'effect'
import { FetchHttpClient, HttpClient } from 'effect/http'
import { connect } from 'node:net'
import { loadavg } from 'node:os'

import * as NodeServices from '@effect/platform-node/NodeServices'

import { yieldTurnAsync } from '../heavy/turn'
import { encodeJson } from '../json'
import { openBrowser, runAuditWith, wait } from './lib'
import { FrameRow, calibrationMs, measureScenario } from './measure'
import { attempt, failWith } from './page'

const BASELINE_PATH = `${import.meta.dir}/frame-baseline.json`

const numberOr = (key: string, fallback: number) =>
  Config.String(key).pipe(Config.withDefault(`${fallback}`), Config.map(Number))

// NOTE: the variables this script reads (see tools/audit/README.md).
const Settings = Config.all({
  port: numberOr('PORT', 4179),
  scenarios: Config.String('SCENARIOS').pipe(Config.option),
  rates: Config.String('RATES').pipe(
    Config.withDefault('1,4,6'),
    Config.map(text => Array.map(String.split(',')(text), Number)),
  ),
  seconds: numberOr('SECONDS', 5),
  trials: numberOr('TRIALS', 2),
  isUpdating: Config.String('UPDATE').pipe(
    Config.withDefault(''),
    Config.map(value => value === '1'),
  ),
  gate: Config.String('GATE').pipe(Config.withDefault('all')),
  jsTolerance: numberOr('JS_TOLERANCE', 0.25),
  busyTolerance: numberOr('BUSY_TOLERANCE', 0.25),
  fpsTolerance: numberOr('FPS_TOLERANCE', 0.15),
  p95Tolerance: numberOr('P95_TOLERANCE', 0.3),
  // NOTE: at 1x, nearly every animation frame with a frame tick must draw in
  // that same frame, whatever the baseline says: a render scheduled a frame
  // late draws only every other frame.
  drawnShareFloor: numberOr('DRAWN_SHARE_FLOOR', 0.9),
  maybeBase: Config.String('BASE').pipe(Config.option),
})
type Settings = Config.Success<typeof Settings>

const scenarioNamesOf = (settings: Settings) =>
  String.split(',')(
    Option.getOrElse(settings.scenarios, () => 'worst,endlessCap,coopLive'),
  )

// NOTE: `UPDATE=1` with `SCENARIOS` records only those scenarios' rows and
// keeps the baseline's others.
const isRecordingSome = (settings: Settings) =>
  Option.exists(settings.scenarios, value => value !== '')

const Baseline = Schema.Struct({
  recordedAt: Schema.String,
  calibrationMs: Schema.Finite,
  loadAverage: Schema.Finite,
  seconds: Schema.Finite,
  rows: Schema.Array(FrameRow),
})
type Baseline = typeof Baseline.Type

const isPortTaken = (port: number) =>
  Effect.callback<boolean>(resume => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resume(Effect.succeed(true))
    })
    socket.once('error', () => resume(Effect.succeed(false)))
  })

// NOTE: whether `url` answers with a 2xx status, false when it does not
// answer at all.
const isServerUp = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.map(response => response.status >= 200 && response.status < 300),
    Effect.orElseSucceed(() => false),
  )

const waitForServer = (url: string) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 100; tries++) {
      const isUp = yield* isServerUp(url)
      if (isUp) {
        return
      }
      yield* wait(100)
    }
    return yield* failWith(`the harness never answered at ${url}`)
  })

const buildHarness = (root: string) =>
  Effect.gen(function* () {
    const code = yield* attempt(
      () =>
        spawn(
          [`${root}/node_modules/.bin/vite`, 'build', 'tools/audit/harness'],
          {
            cwd: root,
            stdout: 'ignore',
            stderr: 'inherit',
          },
        ).exited,
    )
    if (code !== 0) {
      return yield* failWith('the harness build failed')
    }
  })

const startPreview = (root: string, port: number): Subprocess =>
  spawn(
    [
      `${root}/node_modules/.bin/vite`,
      'preview',
      'tools/audit/harness',
      '--port',
      globalThis.String(port),
      '--strictPort',
    ],
    { cwd: root, stdout: 'ignore', stderr: 'inherit', detached: true },
  )

const stopPreview = (server: Subprocess) => {
  try {
    process.kill(-server.pid, 'SIGTERM')
  } catch {
    server.kill()
  }
}

// NOTE: the first trial's row with each timing at its best over all trials.
const bestOf = (trials: ReadonlyArray<FrameRow>) => {
  const [first] = trials
  if (first === undefined) {
    return Effect.fail(failWith('no trials ran'))
  }
  const best = (pick: (row: FrameRow) => number, of: typeof Math.min) =>
    of(...Array.map(trials, pick))
  return Effect.succeed<FrameRow>({
    ...first,
    fps: best(row => row.fps, Math.max),
    p95: best(row => row.p95, Math.min),
    median: best(row => row.median, Math.min),
    jsMs: best(row => row.jsMs, Math.min),
    busyMs: best(row => row.busyMs, Math.min),
    updateMean: best(row => row.updateMean, Math.min),
    viewMean: best(row => row.viewMean, Math.min),
    ...bestCadence(trials),
  })
}

const bestCadence = (trials: ReadonlyArray<FrameRow>) => {
  const drawnFps = Array.flatMap(trials, row =>
    row.drawnFps === undefined ? [] : [row.drawnFps],
  )
  const ticksPerDraw = Array.flatMap(trials, row =>
    row.ticksPerDraw === undefined ? [] : [row.ticksPerDraw],
  )
  const drawnTickShare = Array.flatMap(trials, row =>
    row.drawnTickShare === undefined ? [] : [row.drawnTickShare],
  )
  return {
    ...(drawnFps.length === 0 ? {} : { drawnFps: Math.max(...drawnFps) }),
    ...(ticksPerDraw.length === 0
      ? {}
      : { ticksPerDraw: Math.min(...ticksPerDraw) }),
    ...(drawnTickShare.length === 0
      ? {}
      : { drawnTickShare: Math.max(...drawnTickShare) }),
  }
}

const measureAll = (base: string, settings: Settings) =>
  Effect.scoped(
    Effect.gen(function* () {
      const browser = yield* openBrowser
      const calibration = yield* calibrationMs(browser)
      const names = scenarioNamesOf(settings)
      const rows: Array<FrameRow> = []
      for (const [index, name] of names.entries()) {
        // NOTE: under the heavy guard, other jobs may go between scenarios.
        if (index > 0) {
          yield* attempt(() =>
            yieldTurnAsync(`the ${names[index - 1]} scenario`, 1),
          )
        }
        for (const rate of settings.rates) {
          const trials: Array<FrameRow> = []
          for (let trial = 0; trial < settings.trials; trial++) {
            const measured = yield* measureScenario(
              browser,
              base,
              name,
              rate,
              settings.seconds,
            )
            trials.push(measured)
          }
          const row = yield* bestOf(trials)
          yield* Console.log(
            `${name} ${rate}x: ${row.fps} fps, drawn ${row.drawnFps ?? '?'} fps (${row.ticksPerDraw ?? '?'} ticks per draw, ${row.drawnTickShare ?? '?'} of ticked frames drawn), p95 ${row.p95}ms, js ${row.jsMs}ms (update ${row.updateMean} + view ${row.viewMean}), main thread ${row.busyMs}ms per frame, ${row.shapes} shapes`,
          )
          rows.push(row)
        }
      }
      return { calibration, rows }
    }),
  )

type Check = Readonly<{
  label: string
  measured: number
  limit: number
  isOk: boolean
  isGated: boolean
}>

const checksFor = (
  settings: Settings,
  row: FrameRow,
  baseRow: FrameRow,
  loadFactor: number,
): ReadonlyArray<Check> => {
  const isFrameGated = settings.gate === 'all'
  const jsLimit = baseRow.jsMs * loadFactor * (1 + settings.jsTolerance)
  const busyLimit = baseRow.busyMs * loadFactor * (1 + settings.busyTolerance)
  const fpsFloor = baseRow.fps * (1 - settings.fpsTolerance)
  const p95Limit = baseRow.p95 * (1 + settings.p95Tolerance)
  return [
    ...cadenceChecks(settings, row, baseRow),
    {
      label: 'js ms (update + view)',
      measured: row.jsMs,
      limit: jsLimit,
      isOk: row.jsMs <= jsLimit,
      isGated: true,
    },
    {
      label: 'main thread ms per frame',
      measured: row.busyMs,
      limit: busyLimit,
      isOk: row.busyMs <= busyLimit,
      isGated: true,
    },
    {
      label: 'fps',
      measured: row.fps,
      limit: fpsFloor,
      isOk: row.fps >= fpsFloor,
      isGated: isFrameGated,
    },
    {
      label: 'p95 frame ms',
      measured: row.p95,
      limit: p95Limit,
      isOk: row.p95 <= p95Limit,
      isGated: isFrameGated,
    },
  ]
}

const cadenceChecks = (
  settings: Settings,
  row: FrameRow,
  baseRow: FrameRow,
): ReadonlyArray<Check> => {
  const share = row.drawnTickShare
  const drawn = row.drawnFps
  const baseDrawn = baseRow.drawnFps
  return [
    ...(share !== undefined && row.rate === 1
      ? [
          {
            label: 'share of ticked frames drawn',
            measured: share,
            limit: settings.drawnShareFloor,
            isOk: share >= settings.drawnShareFloor,
            isGated: true,
          },
        ]
      : []),
    ...(drawn !== undefined && baseDrawn !== undefined
      ? [
          {
            label: 'drawn fps',
            measured: drawn,
            limit: baseDrawn * (1 - settings.fpsTolerance),
            isOk: drawn >= baseDrawn * (1 - settings.fpsTolerance),
            isGated: settings.gate === 'all',
          },
        ]
      : []),
  ]
}

const compare = (
  settings: Settings,
  measured: Readonly<{ calibration: number; rows: ReadonlyArray<FrameRow> }>,
  baseline: Baseline,
) =>
  Effect.gen(function* () {
    yield* Console.log(
      `\ncalibration ${measured.calibration.toFixed(1)}ms now, ${baseline.calibrationMs.toFixed(1)}ms in the baseline (${baseline.recordedAt}). CPU time limits scale by how much slower it runs now.`,
    )
    const failures: Array<string> = []
    for (const row of measured.rows) {
      const maybeBaseRow = Array.findFirst(
        baseline.rows,
        candidate =>
          candidate.scenario === row.scenario && candidate.rate === row.rate,
      )
      if (Option.isNone(maybeBaseRow)) {
        yield* Console.log(
          `${row.scenario} ${row.rate}x: no baseline row, skipped`,
        )
        continue
      }
      const baseRow = maybeBaseRow.value
      const loadFactor = Math.max(
        1,
        measured.calibration /
          (baseRow.calibrationMs ?? baseline.calibrationMs),
      )
      for (const check of checksFor(settings, row, baseRow, loadFactor)) {
        const verdict = check.isOk ? 'ok' : check.isGated ? 'FAIL' : 'warn'
        yield* Console.log(
          `${String.padEnd(4)(verdict)} ${row.scenario} ${row.rate}x ${check.label}: ${check.measured.toFixed(2)} (limit ${check.limit.toFixed(2)})`,
        )
        if (!check.isOk && check.isGated) {
          failures.push(`${row.scenario} ${row.rate}x ${check.label}`)
        }
      }
    }
    if (failures.length > 0) {
      yield* Console.log(
        `\nFrame time regressed: ${Array.join(failures, ', ')}`,
      )
      return false
    }
    yield* Console.log('\nFrame time is within the baseline tolerances.')
    return true
  })

// NOTE: the baseline with the measured scenarios' rows recorded again, each
// with the calibration it was recorded with, and every other row kept.
const withRows = (
  baseline: Baseline,
  measured: Readonly<{ calibration: number; rows: ReadonlyArray<FrameRow> }>,
): Baseline => {
  const names = new Set(Array.map(measured.rows, row => row.scenario))
  return {
    ...baseline,
    rows: [
      ...Array.filter(baseline.rows, row => !names.has(row.scenario)),
      ...Array.map(measured.rows, row => ({
        ...row,
        calibrationMs: measured.calibration,
      })),
    ],
  }
}

// NOTE: the baseline file, decoded.
const readBaseline = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const text = yield* fs.readFileString(BASELINE_PATH)
  return yield* Schema.decodeEffect(Schema.fromJsonString(Baseline))(text)
})

const measureAndJudge = (settings: Settings, base: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const measured = yield* measureAll(base, settings)
    if (settings.isUpdating) {
      const hasBaseline = yield* fs.exists(BASELINE_PATH)
      const now = yield* DateTime.now
      const baseline: Baseline =
        isRecordingSome(settings) && hasBaseline
          ? yield* Effect.map(readBaseline, old => withRows(old, measured))
          : {
              recordedAt: DateTime.formatIso(now),
              calibrationMs: measured.calibration,
              loadAverage: loadavg()[0] ?? 0,
              seconds: settings.seconds,
              rows: measured.rows,
            }
      yield* fs.writeFileString(
        BASELINE_PATH,
        `${encodeJson(Baseline, 2)(baseline)}\n`,
      )
      yield* Console.log(`\nWrote ${BASELINE_PATH}`)
      return true
    }
    const hasBaseline = yield* fs.exists(BASELINE_PATH)
    if (!hasBaseline) {
      return yield* failWith(
        'no baseline yet. Run with UPDATE=1 to record one.',
      )
    }
    const baseline = yield* readBaseline
    return yield* compare(settings, measured, baseline)
  })

runAuditWith(
  Effect.gen(function* () {
    const settings = yield* Settings
    const path = yield* Path.Path
    const root = path.resolve(import.meta.dir, '../..')
    const localBase = `http://localhost:${settings.port}/`
    const hasBase = Option.exists(settings.maybeBase, base => base !== '')
    let server: Subprocess | undefined
    if (!hasBase) {
      if (yield* isPortTaken(settings.port)) {
        return yield* failWith(
          `port ${settings.port} is already in use. Stop that server or set PORT.`,
        )
      }
      yield* buildHarness(root)
      server = startPreview(root, settings.port)
      yield* waitForServer(localBase)
    }
    const isPassing = yield* measureAndJudge(
      settings,
      Option.getOrElse(settings.maybeBase, () => localBase),
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (server !== undefined) {
            stopPreview(server)
          }
        }),
      ),
    )
    return yield* Effect.sync(() => process.exit(isPassing ? 0 : 1))
  }),
  Layer.merge(NodeServices.layer, FetchHttpClient.layer),
)
