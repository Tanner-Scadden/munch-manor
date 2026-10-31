// Compact summaries of the bot's runs, written as JSON by
// `simulate.ts --json` and read back by the nightly suite. The Schemas are
// the boundary: the nightly decodes every file it reads with them.

import { Array, Number, Option, Order, Record, Schema, pipe } from 'effect'

import { Difficulty, HomeMode } from '../../src/model'
import type { Kind } from './bot/basics'
import { Counts, type RunResult, type WaveRun } from './bot/results'

// SCHEMAS

const BotStyle = Schema.Literals(['Default', 'SwapsBack'])
type BotStyle = typeof BotStyle.Type

export const CampaignSummary = Schema.TaggedStruct('Campaign', {
  difficulty: Difficulty,
  kind: HomeMode,
  style: BotStyle,
  runs: Schema.Number,
  wallSeconds: Schema.Number,
  winShare: Schema.Number,
  closeCallShare: Schema.Number,
  medianWinMinutes: Schema.Number,
  medianRunMinutes: Schema.Number,
  medianWaveReached: Schema.Number,
  bestWave: Schema.Number,
  worstWave: Schema.Number,
  diedShareByWave: Schema.Array(Schema.Number),
  heartsLostByWave: Schema.Array(Schema.Number),
  lengthSecondsByWave: Schema.Array(Schema.Number),
  hurtShareByKind: Counts,
  kitchenShare: Schema.Number,
})
export type CampaignSummary = typeof CampaignSummary.Type

export const WaveSummary = Schema.Struct({
  wave: Schema.Number,
  runs: Schema.Number,
  snapshots: Schema.Number,
  clearedShare: Schema.Number,
  diedShare: Schema.Number,
  meanHeartsLost: Schema.Number,
  meanLengthSeconds: Schema.Number,
  medianLengthSeconds: Schema.Number,
  p90LengthSeconds: Schema.Number,
  meanEmptySeconds: Schema.Number,
  meanQuietSeconds: Schema.Number,
  worstQuietSeconds: Schema.Number,
  meanPressureSeconds: Schema.Number,
  meanPeakAlive: Schema.Number,
  deathShareByKind: Counts,
  hurtShareByKind: Counts,
})
export type WaveSummary = typeof WaveSummary.Type

export const WavePassSummary = Schema.TaggedStruct('WavePass', {
  difficulty: Difficulty,
  style: BotStyle,
  runsPerWave: Schema.Number,
  slots: Schema.Number,
  wallSeconds: Schema.Number,
  waves: Schema.Array(WaveSummary),
})
export type WavePassSummary = typeof WavePassSummary.Type

export const Summary = Schema.Union([CampaignSummary, WavePassSummary])
export type Summary = typeof Summary.Type

// STATISTICS

export const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : Number.sumAll(values) / values.length

const valueAt = (values: ReadonlyArray<number>, index: number): number =>
  Option.getOrElse(Array.get(values, index), () => 0)

export const median = (values: ReadonlyArray<number>): number => {
  const sorted = Array.sort(values, Order.Number)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (valueAt(sorted, middle - 1) + valueAt(sorted, middle)) / 2
    : valueAt(sorted, middle)
}

export const quantile = (values: ReadonlyArray<number>, q: number): number => {
  const sorted = Array.sort(values, Order.Number)
  return valueAt(
    sorted,
    Math.min(sorted.length - 1, Math.floor(q * sorted.length)),
  )
}

const shareOf = (part: number, whole: number): number =>
  whole === 0 ? 0 : part / whole

const hurtShares = (
  hurts: ReadonlyArray<Readonly<Record<Kind, number>>>,
): Record<string, number> => {
  const totals = Array.reduce(
    hurts,
    Record.empty<string, number>(),
    (sum, hurt) => Record.union(sum, hurt, (left, right) => left + right),
  )
  const all = Number.sumAll(Record.values(totals))
  return Record.map(totals, value => shareOf(value, all))
}

// CAMPAIGN

export type CampaignMeta = Readonly<{
  difficulty: Difficulty
  kind: HomeMode
  style: BotStyle
  wallSeconds: number
  lastWave: number
}>

const wavesUpTo = (lastWave: number): ReadonlyArray<number> =>
  Array.makeBy(Math.max(1, lastWave), index => index + 1)

export const summarizeCampaign = (
  results: ReadonlyArray<RunResult>,
  meta: CampaignMeta,
): CampaignSummary => {
  const runs = results.length
  const wins = Array.filter(results, ({ victory }) => victory)
  const reached = Array.map(results, ({ cleared }) => cleared + 1)
  const deaths = pipe(
    results,
    Array.filter(({ victory }) => !victory),
    Array.map(({ cleared }) => cleared + 1),
  )
  const waveLogs = (wave: number) =>
    Array.flatMap(results, ({ waves }) =>
      Option.toArray(Array.get(waves, wave - 1)),
    )
  return {
    _tag: 'Campaign',
    difficulty: meta.difficulty,
    kind: meta.kind,
    style: meta.style,
    runs,
    wallSeconds: meta.wallSeconds,
    winShare: shareOf(wins.length, runs),
    closeCallShare: shareOf(
      Array.filter(wins, ({ minHp }) => minHp <= 1).length,
      wins.length,
    ),
    medianWinMinutes: median(Array.map(wins, ({ runMs }) => runMs)) / 60000,
    medianRunMinutes: median(Array.map(results, ({ runMs }) => runMs)) / 60000,
    medianWaveReached: median(reached),
    bestWave: Array.reduce(reached, 0, (most, wave) => Math.max(most, wave)),
    worstWave: Array.reduce(reached, Infinity, (least, wave) =>
      Math.min(least, wave),
    ),
    diedShareByWave: Array.map(wavesUpTo(meta.lastWave), wave =>
      shareOf(Array.filter(deaths, death => death === wave).length, runs),
    ),
    heartsLostByWave: Array.map(wavesUpTo(meta.lastWave), wave =>
      mean(Array.map(waveLogs(wave), ({ heartsLost }) => heartsLost)),
    ),
    lengthSecondsByWave: Array.map(wavesUpTo(meta.lastWave), wave =>
      mean(Array.map(waveLogs(wave), ({ lengthMs }) => lengthMs / 1000)),
    ),
    hurtShareByKind: hurtShares(Array.map(results, ({ hurtBy }) => hurtBy)),
    kitchenShare: shareOf(
      Array.filter(results, ({ kitchenWave }) => kitchenWave > 0).length,
      runs,
    ),
  }
}

// NOTE: the shop visits before `wave` over a batch: the money each visit
// arrived with, in run order, how many runs visited, and how many of those
// visits bought each item, most first (ties in the order first bought).
type ShopTally = Readonly<{
  money: ReadonlyArray<number>
  visits: number
  bought: ReadonlyArray<readonly [string, number]>
}>

export const tallyShopVisits = (
  results: ReadonlyArray<RunResult>,
  wave: number,
): ShopTally => {
  const visits = Array.flatMap(results, ({ shopVisits }) =>
    Array.filter(shopVisits, visit => visit.wave === wave),
  )
  const counts = new Map<string, number>()
  visits.forEach(({ bought }) =>
    bought.forEach(item => counts.set(item, (counts.get(item) ?? 0) + 1)),
  )
  return {
    money: Array.map(visits, ({ money }) => money),
    visits: visits.length,
    bought: [...counts.entries()].sort((a, b) => b[1] - a[1]),
  }
}

// WAVE SNAPSHOTS

export const summarizeWave = (
  wave: number,
  runs: ReadonlyArray<WaveRun>,
): WaveSummary => {
  const died = Array.filter(runs, ({ outcome }) => outcome === 'Died')
  const killers = Array.reduce(
    died,
    Record.empty<string, number>(),
    (counts, { killedBy }) => {
      const kind = killedBy ?? 'Unknown'
      return Record.set(counts, kind, (counts[kind] ?? 0) + 1)
    },
  )
  const lengths = Array.map(runs, ({ lengthMs }) => lengthMs / 1000)
  return {
    wave,
    runs: runs.length,
    snapshots: Array.dedupe(Array.map(runs, ({ snapshotSeed }) => snapshotSeed))
      .length,
    clearedShare: shareOf(
      Array.filter(runs, ({ outcome }) => outcome === 'Cleared').length,
      runs.length,
    ),
    diedShare: shareOf(died.length, runs.length),
    meanHeartsLost: mean(Array.map(runs, ({ heartsLost }) => heartsLost)),
    meanLengthSeconds: mean(lengths),
    medianLengthSeconds: median(lengths),
    p90LengthSeconds: quantile(lengths, 0.9),
    meanEmptySeconds: mean(Array.map(runs, ({ emptyMs }) => emptyMs / 1000)),
    meanQuietSeconds: mean(Array.map(runs, ({ quietMs }) => quietMs / 1000)),
    worstQuietSeconds:
      Array.reduce(runs, 0, (most, { longestQuietMs }) =>
        Math.max(most, longestQuietMs),
      ) / 1000,
    meanPressureSeconds: mean(
      Array.map(runs, ({ pressureMs }) => pressureMs / 1000),
    ),
    meanPeakAlive: mean(Array.map(runs, ({ peakAlive }) => peakAlive)),
    deathShareByKind: Record.map(killers, count => shareOf(count, died.length)),
    hurtShareByKind: hurtShares(Array.map(runs, ({ hurtBy }) => hurtBy)),
  }
}

export type WavePassMeta = Readonly<{
  difficulty: Difficulty
  style: BotStyle
  runsPerWave: number
  slots: number
  wallSeconds: number
}>

export const summarizeWavePass = (
  runs: ReadonlyArray<WaveRun>,
  waves: ReadonlyArray<number>,
  meta: WavePassMeta,
): WavePassSummary => ({
  _tag: 'WavePass',
  ...meta,
  waves: Array.map(waves, wave =>
    summarizeWave(
      wave,
      Array.filter(runs, run => run.wave === wave),
    ),
  ),
})

// PRINTING

const percent = (share: number) => `${(100 * share).toFixed(0)}%`

const kindShares = (shares: Readonly<Record<string, number>>): string =>
  pipe(
    Record.toEntries(shares),
    Array.filter(([, share]) => share > 0),
    Array.sort(
      Order.mapInput(
        Order.flip(Order.Number),
        ([, share]: [string, number]) => share,
      ),
    ),
    Array.map(([kind, share]) => `${kind} ${percent(share)}`),
    Array.join(', '),
  )

export const formatWavePass = (summary: WavePassSummary): string =>
  Array.join(
    [
      `Wave snapshots on ${summary.difficulty}${summary.style === 'SwapsBack' ? ', swaps back to the spare' : ''}: ${summary.runsPerWave} runs a wave from ${summary.slots} snapshot slots, in ${summary.wallSeconds.toFixed(1)} s`,
      '',
      'Wave  runs  snaps  cleared  died  hearts lost  length s  median s  p90 s  empty s  quiet s  worst quiet s  pressure s  peak alive  deaths by kind',
      ...Array.map(
        summary.waves,
        wave =>
          `${String(wave.wave).padStart(4)}  ${String(wave.runs).padStart(4)}  ${String(wave.snapshots).padStart(5)}  ${percent(wave.clearedShare).padStart(7)}  ${percent(wave.diedShare).padStart(4)}  ${wave.meanHeartsLost.toFixed(2).padStart(11)}  ${wave.meanLengthSeconds.toFixed(0).padStart(8)}  ${wave.medianLengthSeconds.toFixed(0).padStart(8)}  ${wave.p90LengthSeconds.toFixed(0).padStart(5)}  ${wave.meanEmptySeconds.toFixed(1).padStart(7)}  ${wave.meanQuietSeconds.toFixed(1).padStart(7)}  ${wave.worstQuietSeconds.toFixed(2).padStart(13)}  ${wave.meanPressureSeconds.toFixed(1).padStart(10)}  ${wave.meanPeakAlive.toFixed(1).padStart(10)}  ${kindShares(wave.deathShareByKind)}`,
      ),
    ],
    '\n',
  )
