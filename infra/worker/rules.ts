import { Function, String } from 'effect'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  MAX_SUMMARY_BYTES,
  PostedRunJson,
  type PostedRunSummary,
  PostedShareJson,
  type ShareEvent,
  type ShareEventV1,
  SummaryKills,
  type SummaryParty,
  type SummaryPartyV2,
  type SummaryPartyV6,
} from '../../src/platform/analytics.ts'

// BODY SIZE

export type BodySize = 'Fits' | 'TooLarge'

const sizeOf = (bytes: number): BodySize =>
  bytes > MAX_SUMMARY_BYTES ? 'TooLarge' : 'Fits'

// NOTE: a missing or unreadable Content-Length is not trusted either way. The
// body is still measured after it is read.
export const declaredSize = (contentLength: string | undefined): BodySize =>
  Option.match(Option.fromNullishOr(contentLength), {
    onNone: () => 'Fits',
    onSome: header => {
      const bytes = Number(header)
      return Number.isFinite(bytes) ? sizeOf(bytes) : 'Fits'
    },
  })

export const bodySize = (body: string): BodySize =>
  sizeOf(new TextEncoder().encode(body).byteLength)

// DECODING

// NOTE: this version, or version 1 from a build cached before co-op
// summaries, stored as a solo run.
const decodePostedRun = Schema.decodeUnknownEffect(PostedRunJson)

export const decodeSummary = (input: unknown) => decodePostedRun(input)

const decodePostedShare = Schema.decodeUnknownEffect(PostedShareJson)

export const decodeShare = (input: unknown) => decodePostedShare(input)

// RATE LIMITS

export type RateOutcome = 'Allowed' | 'Limited'

export type RateCheck = Readonly<{ visit: RateOutcome; address: RateOutcome }>

export type RateDecision =
  | Readonly<{ _tag: 'Allowed' }>
  | Readonly<{ _tag: 'Limited'; by: 'Visit' | 'Address' }>

export const rateOutcome = (isWithinLimit: boolean): RateOutcome =>
  isWithinLimit ? 'Allowed' : 'Limited'

export const decideRate = ({ visit, address }: RateCheck): RateDecision => {
  if (address === 'Limited') {
    return { _tag: 'Limited', by: 'Address' }
  } else if (visit === 'Limited') {
    return { _tag: 'Limited', by: 'Visit' }
  } else {
    return { _tag: 'Allowed' }
  }
}

const DAY_LENGTH = 10

const isoOf = (nowMs: number): string =>
  DateTime.formatIso(DateTime.makeUnsafe(nowMs))

export const utcDay = (nowMs: number): string =>
  String.slice(0, DAY_LENGTH)(isoOf(nowMs))

// RETENTION

// NOTE: run rows are kept for 90 days, then the daily cleanup (api.ts,
// scheduled from main.ts) deletes them. A row is kept while its received
// day is on or after the day 90 days before now, so a row lives for 90 to
// 91 days depending on the hour it came in.
export const RETENTION_DAYS = 90

const DAY_MS = 24 * 60 * 60 * 1000

export const retentionCutoffDay = (nowMs: number): string =>
  utcDay(nowMs - RETENTION_DAYS * DAY_MS)

// NOTE: the address bucket is a hash of the IP with a secret salt and the UTC
// day, so it changes every day and cannot be reversed without the salt. It is
// only ever a rate limit key: it is never stored or logged.
export const addressHashInput: {
  (day: string, address: string): (salt: string) => string
  (salt: string, day: string, address: string): string
} = Function.dual(
  3,
  (salt: string, day: string, address: string): string =>
    `${salt}:${day}:${address}`,
)

export const visitRateKey = (visitId: string): string => `visit:${visitId}`

export const addressRateKey = (addressHash: string): string =>
  `address:${addressHash}`

// ROWS

const encodeKills = Schema.encodeEffect(Schema.fromJsonString(SummaryKills))

export type RunRow = Readonly<{
  received_at: string
  received_day: string
  summary_version: number
  visit_id: string
  build: string
  mode: string
  difficulty: string
  wave: number
  outcome: string
  killed_by: string | null
  run_ms: number
  hearts_lost: number
  purchases: number
  keys_spent: number | null
  cases_opened: number | null
  power_ups_grabbed: number
  traps_placed: number
  device: string
  screen_fit: string
  frame_time: string
  kills: string
  party: string
  crew_size: number
  seat_kills: number | null
  seat_downs: number | null
  seat_revives: number | null
  crew_key: string | null
  modifiers: number
  dare_items_found: number
  net_rtt_p50_ms: number | null
  net_rtt_p95_ms: number | null
  net_rtt_samples: number | null
  net_jitter_ms: number | null
  net_snapshots: number | null
  net_late_snapshots: number | null
  net_late_ms_mean: number | null
  net_late_ms_max: number | null
  net_reconnects: number | null
  net_corrections: number | null
  net_correction_px_max: number | null
}>

type NetColumns = Pick<
  RunRow,
  | 'net_rtt_p50_ms'
  | 'net_rtt_p95_ms'
  | 'net_rtt_samples'
  | 'net_jitter_ms'
  | 'net_snapshots'
  | 'net_late_snapshots'
  | 'net_late_ms_mean'
  | 'net_late_ms_max'
  | 'net_reconnects'
  | 'net_corrections'
  | 'net_correction_px_max'
>

// NOTE: a solo run, or a crew from before version 7, has no network.
const NO_NET_COLUMNS: NetColumns = {
  net_rtt_p50_ms: null,
  net_rtt_p95_ms: null,
  net_rtt_samples: null,
  net_jitter_ms: null,
  net_snapshots: null,
  net_late_snapshots: null,
  net_late_ms_mean: null,
  net_late_ms_max: null,
  net_reconnects: null,
  net_corrections: null,
  net_correction_px_max: null,
}

type PartyColumns = Pick<
  RunRow,
  | 'party'
  | 'crew_size'
  | 'seat_kills'
  | 'seat_downs'
  | 'seat_revives'
  | 'crew_key'
> &
  NetColumns

const SOLO_COLUMNS: PartyColumns = {
  party: 'Solo',
  crew_size: 1,
  seat_kills: null,
  seat_downs: null,
  seat_revives: null,
  crew_key: null,
  ...NO_NET_COLUMNS,
}

const netColumnsOf = (
  party: SummaryParty | SummaryPartyV6 | SummaryPartyV2,
): NetColumns =>
  'network' in party
    ? {
        net_rtt_p50_ms: party.network.rttP50Ms,
        net_rtt_p95_ms: party.network.rttP95Ms,
        net_rtt_samples: party.network.rttSamples,
        net_jitter_ms: party.network.jitterMs,
        net_snapshots: party.network.snapshots,
        net_late_snapshots: party.network.lateSnapshots,
        net_late_ms_mean: party.network.lateMsMean,
        net_late_ms_max: party.network.lateMsMax,
        net_reconnects: party.network.reconnects,
        net_corrections: party.network.corrections,
        net_correction_px_max: party.network.correctionPxMax,
      }
    : NO_NET_COLUMNS

// NOTE: a version 2 crew came before the run key, so its key is NULL and
// the report counts its row as a game of its own.
const partyColumnsOf = (
  party: SummaryParty | SummaryPartyV6 | SummaryPartyV2,
): PartyColumns =>
  party._tag === 'Solo'
    ? SOLO_COLUMNS
    : {
        party: party._tag,
        crew_size: party.size,
        seat_kills: party.seatKills,
        seat_downs: party.seatDowns,
        seat_revives: party.seatRevives,
        crew_key: 'runKey' in party ? party.runKey : null,
        ...netColumnsOf(party),
      }

// NOTE: a version 1 summary came before co-op sent any, so it was solo.
const summaryPartyColumns = (summary: PostedRunSummary): PartyColumns =>
  summary.version === 1 ? SOLO_COLUMNS : partyColumnsOf(summary.party)

// NOTE: a version 5 to 8 summary spends keys and opens cases, with no shop
// to buy from (its purchases are 0); an older one bought from the shop, and
// has no keys or cases (NULL).
const shopColumnsOf = (
  summary: PostedRunSummary,
): Pick<RunRow, 'purchases' | 'keys_spent' | 'cases_opened'> =>
  summary.version === 5 ||
  summary.version === 6 ||
  summary.version === 7 ||
  summary.version === 8
    ? {
        purchases: 0,
        keys_spent: summary.keysSpent,
        cases_opened: summary.casesOpened,
      }
    : { purchases: summary.purchases, keys_spent: null, cases_opened: null }

// NOTE: the kills go in as JSON text. They were decoded from the same
// Schema, so the encode cannot fail; if it did, the request dies as before.
export const rowOf: {
  (nowMs: number): (summary: PostedRunSummary) => Effect.Effect<RunRow>
  (summary: PostedRunSummary, nowMs: number): Effect.Effect<RunRow>
} = Function.dual(
  2,
  (summary: PostedRunSummary, nowMs: number): Effect.Effect<RunRow> =>
    Effect.map(Effect.orDie(encodeKills(summary.kills)), (kills): RunRow => ({
      received_at: isoOf(nowMs),
      received_day: utcDay(nowMs),
      summary_version: summary.version,
      visit_id: summary.visitId,
      build: summary.build,
      mode: summary.mode,
      difficulty: summary.difficulty,
      wave: summary.wave,
      outcome: summary.outcome._tag,
      killed_by:
        summary.outcome._tag === 'GameOver' ? summary.outcome.killedBy : null,
      run_ms: summary.runMs,
      hearts_lost: summary.heartsLost,
      ...shopColumnsOf(summary),
      power_ups_grabbed: summary.powerUpsGrabbed,
      traps_placed: summary.trapsPlaced,
      device: summary.device,
      screen_fit: summary.screenFit,
      frame_time: summary.frameTime,
      kills,
      ...summaryPartyColumns(summary),
      modifiers: 'modifiers' in summary ? summary.modifiers : 0,
      dare_items_found:
        'dareItemsFound' in summary ? summary.dareItemsFound : 0,
    })),
)

export type ShareRow = Readonly<{
  received_at: string
  received_day: string
  event_version: number
  visit_id: string
  build: string
  screen: string
  mode: string
  difficulty: string
  path: string
}>

// NOTE: a version 1 event came before the share sheet, so its path was the
// link.
export const shareRowOf: {
  (nowMs: number): (event: ShareEvent | ShareEventV1) => ShareRow
  (event: ShareEvent | ShareEventV1, nowMs: number): ShareRow
} = Function.dual(
  2,
  (event: ShareEvent | ShareEventV1, nowMs: number): ShareRow => ({
    received_at: isoOf(nowMs),
    received_day: utcDay(nowMs),
    event_version: event.version,
    visit_id: event.visitId,
    build: event.build,
    screen: event.screen,
    mode: event.mode,
    difficulty: event.difficulty,
    path: 'path' in event ? event.path : 'Link',
  }),
)
