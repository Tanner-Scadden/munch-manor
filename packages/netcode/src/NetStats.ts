import { Array, Function, Option, Schema } from 'effect'

export const BUCKET_MS = 10
export const BUCKETS = 200
export const OVERFLOW_MS = BUCKETS * BUCKET_MS

export const Histogram = Schema.Struct({
  counts: Schema.Array(Schema.Finite),
  total: Schema.Finite,
})
export type Histogram = typeof Histogram.Type

export const emptyHistogram: Histogram = {
  counts: Array.makeBy(BUCKETS + 1, () => 0),
  total: 0,
}

const bucketOf = (ms: number): number =>
  Math.min(BUCKETS, Math.max(0, Math.floor(ms / BUCKET_MS)))

export const recordSample: {
  (ms: number): (histogram: Histogram) => Histogram
  (histogram: Histogram, ms: number): Histogram
} = Function.dual(2, (histogram: Histogram, ms: number): Histogram => {
  const bucket = bucketOf(ms)
  return {
    counts: Array.map(histogram.counts, (count, index) =>
      index === bucket ? count + 1 : count,
    ),
    total: histogram.total + 1,
  }
})

export const percentileOf: {
  (fraction: number): (histogram: Histogram) => number
  (histogram: Histogram, fraction: number): number
} = Function.dual(2, (histogram: Histogram, fraction: number): number => {
  if (histogram.total <= 0) {
    return 0
  }

  const wanted = Math.max(1, Math.ceil(histogram.total * fraction))
  const reached = Array.reduce(
    histogram.counts,
    { seen: 0, maybeBucket: Option.none<number>() },
    (walk, count, index) => {
      if (Option.isSome(walk.maybeBucket)) {
        return walk
      }
      const seen = walk.seen + count
      return {
        seen,
        maybeBucket: seen >= wanted ? Option.some(index) : Option.none(),
      }
    },
  )
  return Option.match(reached.maybeBucket, {
    onNone: () => OVERFLOW_MS,
    onSome: bucket =>
      bucket >= BUCKETS
        ? OVERFLOW_MS
        : Math.round(bucket * BUCKET_MS + BUCKET_MS / 2),
  })
})

const MEDIAN = 0.5
const P95 = 0.95

export const medianOf = (histogram: Histogram): number =>
  percentileOf(histogram, MEDIAN)

export const p95Of = (histogram: Histogram): number =>
  percentileOf(histogram, P95)

const meanOf = (sum: number, count: number): number =>
  count <= 0 ? 0 : Math.round(sum / count)

export const ClientNet = Schema.Struct({
  rtt: Histogram,
  arrivals: Schema.Finite,
  jitterSumMs: Schema.Finite,
  lateSnapshots: Schema.Finite,
  lateSumMs: Schema.Finite,
  lateMaxMs: Schema.Finite,
  reconnects: Schema.Finite,
  corrections: Schema.Finite,
  correctionMaxPx: Schema.Finite,
})
export type ClientNet = typeof ClientNet.Type

export const LATE_AFTER_MS = 50

export const emptyClientNet: ClientNet = {
  rtt: emptyHistogram,
  arrivals: 0,
  jitterSumMs: 0,
  lateSnapshots: 0,
  lateSumMs: 0,
  lateMaxMs: 0,
  reconnects: 0,
  corrections: 0,
  correctionMaxPx: 0,
}

export const arrivedOff: {
  (offMs: number): (net: ClientNet) => ClientNet
  (net: ClientNet, offMs: number): ClientNet
} = Function.dual(2, (net: ClientNet, offMs: number): ClientNet => {
  const isLate = offMs > LATE_AFTER_MS
  return {
    ...net,
    arrivals: net.arrivals + 1,
    jitterSumMs: net.jitterSumMs + Math.abs(offMs),
    lateSnapshots: net.lateSnapshots + (isLate ? 1 : 0),
    lateSumMs: net.lateSumMs + (isLate ? offMs : 0),
    lateMaxMs: isLate ? Math.max(net.lateMaxMs, offMs) : net.lateMaxMs,
  }
})

export interface ClientNetReport {
  readonly rttP50Ms: number
  readonly rttP95Ms: number
  readonly rttSamples: number
  readonly jitterMs: number
  readonly snapshots: number
  readonly lateSnapshots: number
  readonly lateMsMean: number
  readonly lateMsMax: number
  readonly reconnects: number
  readonly corrections: number
  readonly correctionPxMax: number
}

export const clientNetReportOf = (net: ClientNet): ClientNetReport => ({
  rttP50Ms: medianOf(net.rtt),
  rttP95Ms: p95Of(net.rtt),
  rttSamples: net.rtt.total,
  jitterMs: meanOf(net.jitterSumMs, net.arrivals),
  snapshots: net.arrivals,
  lateSnapshots: net.lateSnapshots,
  lateMsMean: meanOf(net.lateSumMs, net.lateSnapshots),
  lateMsMax: Math.round(net.lateMaxMs),
  reconnects: net.reconnects,
  corrections: net.corrections,
  correctionPxMax: Math.round(net.correctionMaxPx),
})

export interface SeatNet {
  readonly rtt: Histogram
  readonly rttSampledMs: number
  readonly lastRttMs: Option.Option<number>
  readonly rttSwingSumMs: number
  readonly rttSwings: number
  readonly inputs: number
  readonly lateInputs: number
  readonly droppedSamples: number
  readonly maxLateTicks: number
  readonly links: number
}

export const RTT_SAMPLE_EVERY_MS = 1000

export const emptySeatNet = (links: number): SeatNet => ({
  rtt: emptyHistogram,
  rttSampledMs: Number.NEGATIVE_INFINITY,
  lastRttMs: Option.none(),
  rttSwingSumMs: 0,
  rttSwings: 0,
  inputs: 0,
  lateInputs: 0,
  droppedSamples: 0,
  maxLateTicks: 0,
  links,
})

export const heardRtt: {
  (rttMs: number, nowMs: number): (net: SeatNet) => SeatNet
  (net: SeatNet, rttMs: number, nowMs: number): SeatNet
} = Function.dual(3, (net: SeatNet, rttMs: number, nowMs: number): SeatNet => {
  if (rttMs <= 0 || nowMs - net.rttSampledMs < RTT_SAMPLE_EVERY_MS) {
    return net
  }

  const swing = Option.map(net.lastRttMs, last => Math.abs(rttMs - last))
  return {
    ...net,
    rtt: recordSample(net.rtt, rttMs),
    rttSampledMs: nowMs,
    lastRttMs: Option.some(rttMs),
    rttSwingSumMs: net.rttSwingSumMs + Option.getOrElse(swing, () => 0),
    rttSwings: net.rttSwings + (Option.isSome(swing) ? 1 : 0),
  }
})

export const heardInput: {
  (late: number, lateTicks: number): (net: SeatNet) => SeatNet
  (net: SeatNet, late: number, lateTicks: number): SeatNet
} = Function.dual(
  3,
  (net: SeatNet, late: number, lateTicks: number): SeatNet => ({
    ...net,
    inputs: net.inputs + 1,
    lateInputs: net.lateInputs + (late > 0 ? 1 : 0),
    droppedSamples: net.droppedSamples + Math.max(0, late - 1),
    maxLateTicks: Math.max(net.maxLateTicks, lateTicks),
  }),
)

export interface SeatNetReport {
  readonly rttP50Ms: number
  readonly rttP95Ms: number
  readonly rttSamples: number
  readonly jitterMs: number
  readonly inputs: number
  readonly lateInputs: number
  readonly droppedSamples: number
  readonly maxLateTicks: number
  readonly reconnects: number
}

export const seatNetReportOf = (net: SeatNet): SeatNetReport => ({
  rttP50Ms: medianOf(net.rtt),
  rttP95Ms: p95Of(net.rtt),
  rttSamples: net.rtt.total,
  jitterMs: meanOf(net.rttSwingSumMs, net.rttSwings),
  inputs: net.inputs,
  lateInputs: net.lateInputs,
  droppedSamples: net.droppedSamples,
  maxLateTicks: net.maxLateTicks,
  reconnects: Math.max(0, net.links - 1),
})

export interface RoomLag {
  readonly wakes: number
  readonly lateWakes: number
  readonly maxOwedTicks: number
  readonly lostTicks: number
}

export const noLag: RoomLag = {
  wakes: 0,
  lateWakes: 0,
  maxOwedTicks: 0,
  lostTicks: 0,
}

export const LAGGY_RTT_P95_MS = 250
export const LATE_SHARE = 0.05

export interface LinkSigns {
  readonly rttP95Ms: number
  readonly late: number
  readonly of: number
  readonly reconnects: number
}

export const isLaggyLink = ({
  rttP95Ms,
  late,
  of,
  reconnects,
}: LinkSigns): boolean =>
  rttP95Ms > LAGGY_RTT_P95_MS ||
  (of > 0 && late / of > LATE_SHARE) ||
  reconnects > 0

const LATE_WAKE_SHARE = 0.02

export const isRoomLagging = (lag: RoomLag): boolean =>
  lag.lostTicks > 0 ||
  (lag.wakes > 0 && lag.lateWakes / lag.wakes > LATE_WAKE_SHARE)

export const LagVerdict = Schema.Literals([
  'Smooth',
  'OnePlayer',
  'SomePlayers',
  'Server',
])
export type LagVerdict = typeof LagVerdict.Type

export const lagVerdictOf: {
  (isRoomLag: boolean): (laggy: ReadonlyArray<boolean>) => LagVerdict
  (laggy: ReadonlyArray<boolean>, isRoomLag: boolean): LagVerdict
} = Function.dual(
  2,
  (laggy: ReadonlyArray<boolean>, isRoomLag: boolean): LagVerdict => {
    const count = Array.filter(laggy, Function.identity).length
    if (isRoomLag || (laggy.length > 1 && count === laggy.length)) {
      return 'Server'
    }
    if (count === 0) {
      return 'Smooth'
    }
    return count === 1 ? 'OnePlayer' : 'SomePlayers'
  },
)
