// The pure half of the nightly suite: the jobs it runs, the metrics it
// reads from their summaries, the targets and baseline it holds them to,
// and the Markdown report. tools/balance/nightly.ts runs the jobs and does
// the file work.

import {
  Array,
  DateTime,
  Match,
  Option,
  Order,
  Record,
  Schema,
  pipe,
} from 'effect'

import { DIFFICULTY_ORDER } from '../../src/difficulty'
import type { Difficulty } from '../../src/model'
import { type BalanceModel, type WaveRow, loadoutLabel } from './model'
import type { CampaignSummary, WavePassSummary } from './summary'
import {
  PORTRAIT_GAP_TOLERANCE,
  PORTRAIT_PAIRS,
  type PortraitPair,
  TARGETS,
  type Target,
} from './targets'

// JOBS

type View = 'Landscape' | 'Portrait'

export type Job = Readonly<{
  id: string
  title: string
  view: View
  env: Readonly<Record<string, string>>
  args: ReadonlyArray<string>
}>

export type JobSizes = Readonly<{ campaignRuns: number; waveRuns: number }>

export const NIGHTLY_SIZES: JobSizes = { campaignRuns: 200, waveRuns: 100 }

// NOTE: every job sets VIEW, so a VIEW left in the caller's shell never
// turns a landscape job into a portrait one.
const viewEnv = (view: View): Readonly<Record<string, string>> => ({
  VIEW: view === 'Portrait' ? 'portrait' : 'landscape',
})

const campaignJob = (
  id: string,
  title: string,
  env: Readonly<Record<string, string>>,
  sizes: JobSizes,
  view: View = 'Landscape',
): Job => ({
  id,
  title,
  view,
  env: { ...env, ...viewEnv(view) },
  args: [`${sizes.campaignRuns}`, '1'],
})

// NOTE: every job sets AIM too. Easy and Normal are tuned on the human bot
// (tools/balance/bot/hand.ts), Hard and Nightmare on the sharp one, a
// skilled player's stand-in (decided 2026-10-31).
const HUMAN = { AIM: 'human' }
const SHARP = { AIM: 'sharp' }

export const nightlyJobs = (sizes: JobSizes): ReadonlyArray<Job> => [
  campaignJob(
    'normal',
    'Normal, default bot',
    { DIFFICULTY: 'normal', ...HUMAN },
    sizes,
  ),
  campaignJob(
    'normal-swap',
    'Normal, SWAP=1',
    { DIFFICULTY: 'normal', SWAP: '1', ...HUMAN },
    sizes,
  ),
  campaignJob(
    'easy',
    'Easy, default bot',
    { DIFFICULTY: 'easy', ...HUMAN },
    sizes,
  ),
  campaignJob(
    'hard',
    'Hard, AIM=sharp',
    { DIFFICULTY: 'hard', ...SHARP },
    sizes,
  ),
  campaignJob(
    'nightmare',
    'Nightmare, AIM=sharp',
    { DIFFICULTY: 'nightmare', ...SHARP },
    sizes,
  ),
  campaignJob(
    'endless',
    'Endless on Normal, default bot',
    { DIFFICULTY: 'normal', MODE: 'endless', ...HUMAN },
    sizes,
  ),
  campaignJob(
    'portrait-normal',
    'Portrait, Normal, default bot',
    { DIFFICULTY: 'normal', ...HUMAN },
    sizes,
    'Portrait',
  ),
  campaignJob(
    'portrait-easy',
    'Portrait, Easy, default bot',
    { DIFFICULTY: 'easy', ...HUMAN },
    sizes,
    'Portrait',
  ),
  {
    id: 'waves',
    title: 'Wave snapshots on Normal, every wave',
    view: 'Landscape',
    env: { DIFFICULTY: 'normal', ...HUMAN, ...viewEnv('Landscape') },
    args: ['--wave', 'all', '--runs', `${sizes.waveRuns}`],
  },
]

// ARGUMENTS

type BaselinePolicy = 'Update' | 'Extend' | 'KeepUnlessMissing'

export type Invocation = Readonly<{
  sizes: JobSizes
  baselinePolicy: BaselinePolicy
}>

const flagNumber = (
  args: ReadonlyArray<string>,
  flag: string,
  fallback: number,
): number =>
  pipe(
    Array.findFirstIndex(args, arg => arg === flag),
    Option.flatMap(index => Array.get(args, index + 1)),
    Option.map(Number),
    Option.filter(value => Number.isInteger(value) && value > 0),
    Option.getOrElse(() => fallback),
  )

export const parseInvocation = (args: ReadonlyArray<string>): Invocation => ({
  sizes: {
    campaignRuns: flagNumber(args, '--runs', NIGHTLY_SIZES.campaignRuns),
    waveRuns: flagNumber(args, '--wave-runs', NIGHTLY_SIZES.waveRuns),
  },
  baselinePolicy: Array.contains(args, '--update-baseline')
    ? 'Update'
    : Array.contains(args, '--extend-baseline')
      ? 'Extend'
      : 'KeepUnlessMissing',
})

// DATES

// NOTE: the day on the laptop's own clock, as YYYY-MM-DD.
export const localDate = (ms: number): string =>
  DateTime.formatIsoDate(
    DateTime.makeZonedUnsafe(ms, { timeZone: DateTime.zoneMakeLocal() }),
  )

// METRICS

type Unit = 'Share' | 'Minutes' | 'Seconds' | 'Hearts' | 'Wave' | 'Ratio'

export type Metric = Readonly<{
  key: string
  label: string
  value: number
  tolerance: number
  unit: Unit
}>

// NOTE: how far a metric may move from the baseline before the report calls
// it drift. Runs of 200 swing by about 5 points from noise alone, and runs
// of 100 by about 8, so the tolerances sit at that noise.
const TOLERANCE: Readonly<Record<string, number>> = {
  wins: 0.05,
  closeCalls: 0.1,
  died: 0.04,
  diedPair: 0.05,
  minutes: 0.5,
  hearts: 0.3,
  waveLength: 6,
  endlessWave: 1,
  snapshotShare: 0.08,
  snapshotSeconds: 4,
  emptySeconds: 2,
  quietSeconds: 0.5,
  modelRatio: 0.05,
  modelSeconds: 2,
  modelDps: 0.1,
}

const tolerance = (name: string): number => TOLERANCE[name] ?? 0

const metric = (
  key: string,
  label: string,
  value: number,
  toleranceName: string,
  unit: Unit,
): Metric => ({ key, label, value, tolerance: tolerance(toleranceName), unit })

const valueAt = (values: ReadonlyArray<number>, wave: number): number =>
  Option.getOrElse(Array.get(values, wave - 1), () => 0)

const peakWave = (shares: ReadonlyArray<number>): number =>
  pipe(
    shares,
    Array.map((share, index) => ({ share, wave: index + 1 })),
    Array.reduce({ share: -1, wave: 0 }, (best, next) =>
      next.share > best.share ? next : best,
    ),
    ({ wave }) => wave,
  )

const DEATH_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [3, 4],
  [5, 6],
  [7, 8],
  [9, 10],
]

export const campaignMetrics = (
  id: string,
  title: string,
  summary: CampaignSummary,
): ReadonlyArray<Metric> => {
  const waves = Array.makeBy(summary.diedShareByWave.length, index => index + 1)
  const common = [
    metric(`${id}.wins`, `${title}: wins`, summary.winShare, 'wins', 'Share'),
    metric(
      `${id}.medianRun`,
      `${title}: median run (minutes)`,
      summary.medianRunMinutes,
      'minutes',
      'Minutes',
    ),
  ]
  if (summary.kind === 'Endless') {
    return [
      ...common,
      metric(
        `${id}.medianWave`,
        `${title}: median wave reached`,
        summary.medianWaveReached,
        'endlessWave',
        'Wave',
      ),
      metric(
        `${id}.bestWave`,
        `${title}: best wave reached`,
        summary.bestWave,
        'endlessWave',
        'Wave',
      ),
    ]
  }
  const winMetrics =
    summary.winShare > 0
      ? [
          metric(
            `${id}.medianWin`,
            `${title}: median win (minutes)`,
            summary.medianWinMinutes,
            'minutes',
            'Minutes',
          ),
          metric(
            `${id}.closeCalls`,
            `${title}: close calls`,
            summary.closeCallShare,
            'closeCalls',
            'Share',
          ),
        ]
      : []
  const perWave = Array.flatMap(waves, wave => [
    metric(
      `${id}.died.w${wave}`,
      `${title}: died on wave ${wave}`,
      valueAt(summary.diedShareByWave, wave),
      'died',
      'Share',
    ),
    metric(
      `${id}.hearts.w${wave}`,
      `${title}: hearts lost on wave ${wave}`,
      valueAt(summary.heartsLostByWave, wave),
      'hearts',
      'Hearts',
    ),
    metric(
      `${id}.length.w${wave}`,
      `${title}: wave ${wave} length (seconds)`,
      valueAt(summary.lengthSecondsByWave, wave),
      'waveLength',
      'Seconds',
    ),
  ])
  const pairs = Array.map(DEATH_PAIRS, ([first, second]) =>
    metric(
      `${id}.died.w${first}-${second}`,
      `${title}: died on waves ${first} and ${second}`,
      valueAt(summary.diedShareByWave, first) +
        valueAt(summary.diedShareByWave, second),
      'diedPair',
      'Share',
    ),
  )
  return [
    ...common,
    ...winMetrics,
    ...pairs,
    metric(
      `${id}.died.peakWave`,
      `${title}: wave with the most deaths`,
      peakWave(summary.diedShareByWave),
      'none',
      'Wave',
    ),
    ...perWave,
  ]
}

export const wavePassMetrics = (
  summary: WavePassSummary,
): ReadonlyArray<Metric> =>
  Array.flatMap(summary.waves, wave => {
    const key = `waves.w${wave.wave}`
    const title = `Snapshot wave ${wave.wave}`
    return [
      metric(
        `${key}.cleared`,
        `${title}: cleared`,
        wave.clearedShare,
        'snapshotShare',
        'Share',
      ),
      metric(
        `${key}.hearts`,
        `${title}: hearts lost`,
        wave.meanHeartsLost,
        'hearts',
        'Hearts',
      ),
      metric(
        `${key}.length`,
        `${title}: length (seconds)`,
        wave.meanLengthSeconds,
        'snapshotSeconds',
        'Seconds',
      ),
      metric(
        `${key}.medianLength`,
        `${title}: median length (seconds)`,
        wave.medianLengthSeconds,
        'snapshotSeconds',
        'Seconds',
      ),
      metric(
        `${key}.p90Length`,
        `${title}: slowest tenth length (seconds)`,
        wave.p90LengthSeconds,
        'snapshotSeconds',
        'Seconds',
      ),
      metric(
        `${key}.empty`,
        `${title}: empty room (seconds)`,
        wave.meanEmptySeconds,
        'emptySeconds',
        'Seconds',
      ),
      metric(
        `${key}.quiet`,
        `${title}: quiet empty room mid-wave (seconds)`,
        wave.meanQuietSeconds,
        'quietSeconds',
        'Seconds',
      ),
      metric(
        `${key}.worstQuiet`,
        `${title}: longest quiet empty room in any run (seconds)`,
        wave.worstQuietSeconds,
        'quietSeconds',
        'Seconds',
      ),
    ]
  })

// NOTE: the sawtooth's peaks are held on Hard (see PEAK_RATIO_TARGET in
// targets.ts); Normal's rows stay for the record.
export const modelMetrics = (model: BalanceModel): ReadonlyArray<Metric> => [
  ...Array.map(model.Hard, row =>
    metric(
      `model.hard.peakRatio.w${row.wave}`,
      `Model: wave ${row.wave} peak incoming hp/s over dps (Hard)`,
      row.peakRatio,
      'modelRatio',
      'Ratio',
    ),
  ),
  ...Array.flatMap(model.Normal, row => [
    metric(
      `model.normal.peakRatio.w${row.wave}`,
      `Model: wave ${row.wave} peak incoming hp/s over dps (Normal)`,
      row.peakRatio,
      'modelRatio',
      'Ratio',
    ),
    metric(
      `model.normal.length.w${row.wave}`,
      `Model: wave ${row.wave} length (seconds, Normal)`,
      row.lengthSeconds,
      'modelSeconds',
      'Seconds',
    ),
    metric(
      `model.normal.dps.w${row.wave}`,
      `Model: wave ${row.wave} player dps (Normal)`,
      row.dps,
      'modelDps',
      'Ratio',
    ),
  ]),
]

// TARGETS

export type Verdict =
  | Readonly<{ _tag: 'InTarget'; target: Target; value: number }>
  | Readonly<{ _tag: 'Below'; target: Target; value: number }>
  | Readonly<{ _tag: 'Above'; target: Target; value: number }>
  | Readonly<{ _tag: 'NoData'; target: Target }>

const findMetric = (
  metrics: ReadonlyArray<Metric>,
  key: string,
): Option.Option<Metric> =>
  Array.findFirst(metrics, candidate => candidate.key === key)

export const judge = (
  metrics: ReadonlyArray<Metric>,
  targets: ReadonlyArray<Target> = TARGETS,
): ReadonlyArray<Verdict> =>
  Array.map(targets, (target): Verdict =>
    Option.match(findMetric(metrics, target.key), {
      onNone: () => ({ _tag: 'NoData', target }),
      onSome: ({ value }) =>
        Option.exists(target.maybeMin, min => value < min)
          ? { _tag: 'Below', target, value }
          : Option.exists(target.maybeMax, max => value > max)
            ? { _tag: 'Above', target, value }
            : { _tag: 'InTarget', target, value },
    }),
  )

// BASELINE

export const Baseline = Schema.Struct({
  createdAt: Schema.String,
  commit: Schema.String,
  metrics: Schema.Record(Schema.String, Schema.Number),
})
export type Baseline = typeof Baseline.Type

export const BaselineJson = Schema.fromJsonString(Baseline)

export const baselineOf = (
  metrics: ReadonlyArray<Metric>,
  createdAt: string,
  commit: string,
): Baseline => ({
  createdAt,
  commit,
  metrics: Record.fromIterableWith(metrics, ({ key, value }) => [
    key,
    Math.round(value * 10000) / 10000,
  ]),
})

export type Drift =
  | Readonly<{ _tag: 'Within'; metric: Metric; baseline: number }>
  | Readonly<{
      _tag: 'Drifted'
      metric: Metric
      baseline: number
      delta: number
    }>
  | Readonly<{ _tag: 'New'; metric: Metric }>
  | Readonly<{ _tag: 'Missing'; key: string; baseline: number }>

// NOTE: the baseline keeps four decimals, so a deterministic metric can be
// off by up to 0.00005 from it. This slack keeps that, and a value sitting
// exactly on the tolerance, from being called drift.
const EPSILON = 1e-4

export const compareToBaseline = (
  metrics: ReadonlyArray<Metric>,
  baseline: Baseline,
): ReadonlyArray<Drift> => {
  const compared = Array.map(metrics, (current): Drift =>
    Option.match(Record.get(baseline.metrics, current.key), {
      onNone: () => ({ _tag: 'New', metric: current }),
      onSome: (before): Drift => {
        const delta = current.value - before
        return Math.abs(delta) > current.tolerance + EPSILON
          ? { _tag: 'Drifted', metric: current, baseline: before, delta }
          : { _tag: 'Within', metric: current, baseline: before }
      },
    }),
  )
  const missing = pipe(
    Record.toEntries(baseline.metrics),
    Array.filter(([key]) => Option.isNone(findMetric(metrics, key))),
    Array.map(([key, before]): Drift => ({
      _tag: 'Missing',
      key,
      baseline: before,
    })),
  )
  return [...compared, ...missing]
}

// NOTE: keeps every number already in the baseline and adds the metrics it
// has never seen, so a new job gets a baseline without moving the old ones.
export const extendBaseline = (
  before: Baseline,
  metrics: ReadonlyArray<Metric>,
): Baseline => ({
  ...before,
  metrics: {
    ...baselineOf(metrics, before.createdAt, before.commit).metrics,
    ...before.metrics,
  },
})

// PORTRAIT

export type PortraitGap = Readonly<{
  pair: PortraitPair
  landscape: CampaignSummary
  portrait: CampaignSummary
  winGap: number
  isBeyond: boolean
}>

const summaryOf = (
  results: ReadonlyArray<CampaignResult>,
  id: string,
): Option.Option<CampaignSummary> =>
  Option.map(
    Array.findFirst(results, ({ job }) => job.id === id),
    ({ summary }) => summary,
  )

export const portraitGaps = (
  results: ReadonlyArray<CampaignResult>,
): ReadonlyArray<PortraitGap> =>
  Array.flatMap(PORTRAIT_PAIRS, pair =>
    Option.match(
      Option.all([
        summaryOf(results, pair.landscapeId),
        summaryOf(results, pair.portraitId),
      ]),
      {
        onNone: () => [],
        onSome: ([landscape, portrait]): ReadonlyArray<PortraitGap> => {
          const winGap = portrait.winShare - landscape.winShare
          return [
            {
              pair,
              landscape,
              portrait,
              winGap,
              isBeyond: Math.abs(winGap) > PORTRAIT_GAP_TOLERANCE + EPSILON,
            },
          ]
        },
      },
    ),
  )

export const portraitGapLine = (gap: PortraitGap): string =>
  `${gap.pair.title}: portrait wins ${formatValue(gap.portrait.winShare, 'Share')} against landscape ${formatValue(gap.landscape.winShare, 'Share')} (${formatDelta(gap.winGap, 'Share')}, tolerance ${formatValue(PORTRAIT_GAP_TOLERANCE, 'Share')})`

// REPORT

const formatValue = (value: number, unit: Unit): string =>
  unit === 'Share'
    ? `${(100 * value).toFixed(1)}%`
    : unit === 'Wave'
      ? value.toFixed(0)
      : value.toFixed(2)

const formatDelta = (delta: number, unit: Unit): string => {
  const sign = delta >= 0 ? '+' : ''
  return unit === 'Share'
    ? `${sign}${(100 * delta).toFixed(1)} points`
    : `${sign}${delta.toFixed(2)}`
}

const unitOfTarget = (metrics: ReadonlyArray<Metric>, target: Target): Unit =>
  Option.match(findMetric(metrics, target.key), {
    onNone: () => 'Ratio',
    onSome: ({ unit }) => unit,
  })

const rangeOf = (target: Target, unit: Unit): string =>
  Option.match(target.maybeMin, {
    onNone: () =>
      Option.match(target.maybeMax, {
        onNone: () => 'any',
        onSome: max => `at most ${formatValue(max, unit)}`,
      }),
    onSome: min =>
      Option.match(target.maybeMax, {
        onNone: () => `at least ${formatValue(min, unit)}`,
        onSome: max =>
          min === max
            ? formatValue(min, unit)
            : `${formatValue(min, unit)} to ${formatValue(max, unit)}`,
      }),
  })

const verdictLine = (
  metrics: ReadonlyArray<Metric>,
  verdict: Verdict,
): string => {
  const unit = unitOfTarget(metrics, verdict.target)
  const range = rangeOf(verdict.target, unit)
  return verdict._tag === 'NoData'
    ? `${verdict.target.label}: no data (target ${range})`
    : `${verdict.target.label}: ${formatValue(verdict.value, unit)} (target ${range})`
}

export const driftLine = (drift: Drift): string =>
  Match.valueTags(drift, {
    Drifted: ({ metric: measured, baseline, delta }) =>
      `${measured.label}: ${formatValue(baseline, measured.unit)} to ${formatValue(measured.value, measured.unit)} (${formatDelta(delta, measured.unit)}, tolerance ${formatValue(measured.tolerance, measured.unit)})`,
    Missing: ({ key }) => `${key}: in the baseline but not measured`,
    New: ({ metric: measured }) =>
      `${measured.label}: new, ${formatValue(measured.value, measured.unit)}`,
    Within: ({ metric: measured }) =>
      `${measured.label}: ${formatValue(measured.value, measured.unit)}`,
  })

const bullets = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  Array.isReadonlyArrayEmpty(lines)
    ? ['- None.']
    : Array.map(lines, line => `- ${line}`)

export type BaselineState =
  | Readonly<{ _tag: 'Compared'; baseline: Baseline }>
  | Readonly<{ _tag: 'Absent' }>

export type BaselineWrite = 'Written' | 'Extended' | 'Kept'

export type CampaignResult = Readonly<{
  job: Job
  summary: CampaignSummary
}>

export type ReportInput = Readonly<{
  date: string
  commit: string
  wallSeconds: number
  workers: string
  campaigns: ReadonlyArray<CampaignResult>
  maybeWavePass: Option.Option<WavePassSummary>
  model: BalanceModel
  metrics: ReadonlyArray<Metric>
  baselineState: BaselineState
  baselineWrite: BaselineWrite
}>

const percent = (share: number): string => `${(100 * share).toFixed(0)}%`

const campaignTable = (results: ReadonlyArray<CampaignResult>): string => {
  const rows = Array.map(
    results,
    ({ job, summary }) =>
      `| ${job.title} | ${summary.runs} | ${percent(summary.winShare)} | ${summary.winShare > 0 ? percent(summary.closeCallShare) : ''} | ${summary.winShare > 0 ? summary.medianWinMinutes.toFixed(1) : ''} | ${summary.medianRunMinutes.toFixed(1)} | ${summary.medianWaveReached} | ${summary.wallSeconds.toFixed(0)} s |`,
  )
  return Array.join(
    [
      '| Job | Runs | Wins | Close calls | Median win (min) | Median run (min) | Median wave reached | Wall time |',
      '| --- | ---- | ---- | ----------- | ---------------- | ---------------- | ------------------- | --------- |',
      ...rows,
    ],
    '\n',
  )
}

const deathsTable = (results: ReadonlyArray<CampaignResult>): string => {
  const campaigns = Array.filter(
    results,
    ({ summary }) => summary.kind === 'Campaign',
  )
  const waves = pipe(
    Array.head(campaigns),
    Option.match({
      onNone: () => [],
      onSome: ({ summary }) =>
        Array.makeBy(summary.diedShareByWave.length, index => index + 1),
    }),
  )
  return Array.join(
    [
      `| Wave | ${Array.join(
        Array.map(campaigns, ({ job }) => job.title),
        ' | ',
      )} |`,
      `| ---- | ${Array.join(
        Array.map(campaigns, () => '---'),
        ' | ',
      )} |`,
      ...Array.map(
        waves,
        wave =>
          `| ${wave} | ${Array.join(
            Array.map(campaigns, ({ summary }) =>
              percent(valueAt(summary.diedShareByWave, wave)),
            ),
            ' | ',
          )} |`,
      ),
    ],
    '\n',
  )
}

const normalWavesTable = (results: ReadonlyArray<CampaignResult>): string =>
  pipe(
    Array.findFirst(results, ({ job }) => job.id === 'normal'),
    Option.match({
      onNone: () => 'No Normal campaign in this run.',
      onSome: ({ summary }) =>
        Array.join(
          [
            '| Wave | Died | Hearts lost | Length s |',
            '| ---- | ---- | ----------- | -------- |',
            ...Array.makeBy(summary.diedShareByWave.length, index => {
              const wave = index + 1
              return `| ${wave} | ${percent(valueAt(summary.diedShareByWave, wave))} | ${valueAt(summary.heartsLostByWave, wave).toFixed(2)} | ${valueAt(summary.lengthSecondsByWave, wave).toFixed(0)} |`
            }),
          ],
          '\n',
        ),
    }),
  )

const kindShares = (shares: Readonly<Record<string, number>>): string =>
  pipe(
    Record.toEntries(shares),
    Array.filter(([, share]) => share > 0),
    Array.sort(
      Order.mapInput(
        Order.flip(Order.Number),
        ([, share]: readonly [string, number]) => share,
      ),
    ),
    Array.map(([kind, share]) => `${kind} ${percent(share)}`),
    Array.join(', '),
  )

const wavePassTable = (pass: WavePassSummary): string =>
  Array.join(
    [
      `${pass.runsPerWave} runs a wave from ${pass.slots} snapshot slots, ${pass.wallSeconds.toFixed(0)} s.`,
      '',
      '| Wave | Runs | Snapshots | Cleared | Hearts lost | Length s | Median s | Slowest tenth s | Empty s | Quiet s | Worst quiet s | Pressure s | Deaths by kind |',
      '| ---- | ---- | --------- | ------- | ----------- | -------- | -------- | --------------- | ------- | ------- | ------------- | ---------- | -------------- |',
      ...Array.map(
        pass.waves,
        wave =>
          `| ${wave.wave} | ${wave.runs} | ${wave.snapshots} | ${percent(wave.clearedShare)} | ${wave.meanHeartsLost.toFixed(2)} | ${wave.meanLengthSeconds.toFixed(0)} | ${wave.medianLengthSeconds.toFixed(0)} | ${wave.p90LengthSeconds.toFixed(0)} | ${wave.meanEmptySeconds.toFixed(1)} | ${wave.meanQuietSeconds.toFixed(1)} | ${wave.worstQuietSeconds.toFixed(2)} | ${wave.meanPressureSeconds.toFixed(1)} | ${kindShares(wave.deathShareByKind)} |`,
      ),
    ],
    '\n',
  )

const modelRow = (row: WaveRow): string =>
  `| ${row.wave} | ${row.totalHp.toFixed(0)} | $${row.moneyOnArrival.toFixed(0)} | ${loadoutLabel(row.loadout)} | ${row.dps.toFixed(2)} | ${row.lengthSeconds.toFixed(0)} | ${row.emptySeconds.toFixed(1)} | ${row.peakIncomingHps.toFixed(2)} | ${row.peakRatio.toFixed(2)} |`

const modelTable = (model: BalanceModel): string =>
  Array.join(
    [
      '| Wave | Total hp | Money on arrival | Loadout | DPS | Length s | Empty s | Peak in hp/s | Peak / DPS |',
      '| ---- | -------- | ---------------- | ------- | --- | -------- | ------- | ------------ | ---------- |',
      ...Array.map(model.Normal, modelRow),
      '',
      `Peak / DPS by level: ${Array.join(
        Array.map(
          DIFFICULTY_ORDER,
          (difficulty: Difficulty) =>
            `${difficulty} ${Array.join(
              Array.map(model[difficulty], ({ peakRatio }) =>
                peakRatio.toFixed(2),
              ),
              ', ',
            )}`,
        ),
        '; ',
      )}.`,
    ],
    '\n',
  )

const isDrift = (drift: Drift): boolean =>
  drift._tag === 'Drifted' || drift._tag === 'Missing'

export const formatReport = (input: ReportInput): string => {
  const verdicts = judge(input.metrics)
  const inTarget = Array.filter(verdicts, ({ _tag }) => _tag === 'InTarget')
  const outOfTarget = Array.filter(verdicts, ({ _tag }) => _tag !== 'InTarget')
  const drifts =
    input.baselineState._tag === 'Compared'
      ? compareToBaseline(input.metrics, input.baselineState.baseline)
      : []
  const drifted = Array.filter(drifts, isDrift)
  const gaps = portraitGaps(input.campaigns)
  const wideGaps = Array.filter(gaps, ({ isBeyond }) => isBeyond)
  const landscapeCampaigns = Array.filter(
    input.campaigns,
    ({ job }) => job.view === 'Landscape',
  )
  const portraitCampaigns = Array.filter(
    input.campaigns,
    ({ job }) => job.view === 'Portrait',
  )
  const baselineNote =
    input.baselineState._tag === 'Absent'
      ? 'No baseline yet, so nothing is compared.'
      : `Compared with the baseline from ${input.baselineState.baseline.createdAt} (${input.baselineState.baseline.commit}).`
  const writeNote =
    input.baselineWrite === 'Written'
      ? ' This run wrote a new baseline to tools/balance/baseline.json.'
      : input.baselineWrite === 'Extended'
        ? ' This run added its new metrics to tools/balance/baseline.json and kept the rest.'
        : ''
  return Array.join(
    [
      `# Balance nightly, ${input.date}`,
      '',
      `Commit ${input.commit}. WORKERS=${input.workers}. Wall time ${(input.wallSeconds / 60).toFixed(1)} minutes. ${baselineNote}${writeNote}`,
      '',
      '## Summary',
      '',
      `### In target (${inTarget.length} of ${verdicts.length})`,
      '',
      ...bullets(
        Array.map(inTarget, verdict => verdictLine(input.metrics, verdict)),
      ),
      '',
      `### Drifted beyond tolerance against the baseline (${drifted.length})`,
      '',
      ...bullets(Array.map(drifted, driftLine)),
      '',
      `### Out of target (${outOfTarget.length})`,
      '',
      ...bullets(
        Array.map(outOfTarget, verdict => verdictLine(input.metrics, verdict)),
      ),
      '',
      `### Portrait wins beyond tolerance against landscape (${wideGaps.length})`,
      '',
      ...bullets(Array.map(wideGaps, portraitGapLine)),
      '',
      '## Campaign bots',
      '',
      campaignTable(landscapeCampaigns),
      '',
      'Share of all runs that died on each wave:',
      '',
      deathsTable(landscapeCampaigns),
      '',
      'Normal, default bot, per wave (means over runs that played the wave):',
      '',
      normalWavesTable(landscapeCampaigns),
      '',
      '## Portrait',
      '',
      'The same bots in the portrait window of a 390x844 phone (135 by 180 of the room), seeing only the zombies inside it.',
      '',
      Array.isReadonlyArrayEmpty(portraitCampaigns)
        ? 'No portrait campaign in this run.'
        : campaignTable(portraitCampaigns),
      '',
      'Portrait against landscape:',
      '',
      ...bullets(Array.map(gaps, portraitGapLine)),
      '',
      'Share of all runs that died on each wave, landscape and portrait side by side:',
      '',
      deathsTable(
        Array.flatMap(PORTRAIT_PAIRS, ({ landscapeId, portraitId }) =>
          Array.filter(
            input.campaigns,
            ({ job }) => job.id === landscapeId || job.id === portraitId,
          ),
        ),
      ),
      '',
      '## Wave snapshots',
      '',
      Option.match(input.maybeWavePass, {
        onNone: () => 'No wave snapshot pass in this run.',
        onSome: wavePassTable,
      }),
      '',
      '## Analytical model (Normal)',
      '',
      modelTable(input.model),
      '',
    ],
    '\n',
  )
}
