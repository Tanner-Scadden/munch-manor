import { Array, Function, Option, Schema } from 'effect'

// NOTE: how a connection did over a run, measured as plain data so the
// room (Room.ts) and the client (Session.ts) keep it beside their state and
// a Foldkit Model can hold it. Round trips go in a fixed histogram, so the
// median and the 95th percentile cost one small array however long the
// run, and nothing is kept per sample.

// HISTOGRAM

export const BUCKET_MS = 10
export const BUCKETS = 200
// NOTE: the last bucket holds every sample from BUCKETS * BUCKET_MS up.
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

// NOTE: the middle of the bucket the share `fraction` of samples reaches,
// rounded, or OVERFLOW_MS for the last bucket. 0 with no samples.
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

// CLIENT

// NOTE: one client's view of a run. `rtt` holds each raw round trip of the
// socket's ping (every 2 seconds). `arrivals` counts the room's Deltas
// timed against the one before, `jitterSumMs` how far off their spacing
// was in all; a Delta more than LATE_AFTER_MS later than its tick says is
// late, `lateSumMs` and `lateMaxMs` by how much. `reconnects` counts the
// links that dropped and came back, `corrections` the times the room's word
// moved your own predicted player, and `correctionMaxPx` the biggest move.
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

// NOTE: the room sends every 50 ms, so a Delta this much later than its
// spacing says is a whole send late.
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

// NOTE: a Delta arrived `offMs` from when the one before says it should:
// negative is early, positive late.
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

// NOTE: what a run summary sends of a ClientNet, every number a whole one.
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

// ROOM

// NOTE: one seat's link as the room saw it over a run. `rtt` samples the
// round trip the player's client reports, at most once per
// RTT_SAMPLE_EVERY_MS, and `rttSwingSumMs` adds how far each sample moved
// from the one before (`rttSwings` of them), the jitter. `inputs` counts the
// Input frames, `lateInputs` those that came with samples for ticks the
// room already ran, `droppedSamples` the late samples another replaced, and
// `maxLateTicks` the latest. `reconnects` counts the sockets that linked
// after the first.
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

// NOTE: the client reported `rttMs` now. A 0 is a client that has not
// measured yet.
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

// NOTE: an Input frame whose samples for ticks already run were `late`,
// the oldest of them `lateTicks` behind the room's tick.
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

// NOTE: the room's own loop over a run. Each wake runs the ticks the clock
// owes, about TICKS_PER_SEND. `lateWakes` owed more than twice that (the
// loop woke a send or more late), `maxOwedTicks` is the most one wake owed,
// and `lostTicks` the ticks dropped past MAX_CATCH_UP_TICKS, time the game
// lost rather than spin to catch up.
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

// VERDICT

// NOTE: a link that lagged: a slow tail of round trips, more than one in
// LATE_SHARE of its messages late, or a reconnect.
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

// NOTE: the room's own loop lagged: it lost ticks, or more than one wake
// in fifty came late.
const LATE_WAKE_SHARE = 0.02

export const isRoomLagging = (lag: RoomLag): boolean =>
  lag.lostTicks > 0 ||
  (lag.wakes > 0 && lag.lateWakes / lag.wakes > LATE_WAKE_SHARE)

// NOTE: where one game's lag came from. Every seat lagging together, or
// the room's own loop, points at the server (or the path to it); one
// seat alone, or some, at those players' connections.
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
