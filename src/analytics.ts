import { Schema } from 'effect'

import { Difficulty } from './playerData'

// NOTE: this file is shared with the analytics Worker in infra/worker, which
// bundles it against its own, newer Effect. It imports nothing but `effect`
// and src/playerData.ts, which is shared the same way, and uses only Schema
// APIs both versions have. The literal lists the game keeps outside
// playerData.ts (ZombieKind, HomeMode, InputDevice) are repeated here so the
// Worker never pulls in the game, and src/analytics.story.test.ts checks that
// they still match.

// RUN SUMMARY

export const RUN_SUMMARY_VERSION = 1

export const MAX_SUMMARY_BYTES = 8 * 1024

export const SummaryKind = Schema.Literals([
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
])
export type SummaryKind = typeof SummaryKind.Type

export const SummaryMode = Schema.Literals(['Campaign', 'Endless'])
type SummaryMode = typeof SummaryMode.Type

export const SummaryDevice = Schema.Literals(['KeyboardMouse', 'Touch'])
export type SummaryDevice = typeof SummaryDevice.Type

export const SummaryScreenFit = Schema.Literals(['Browser', 'Installed'])
export type SummaryScreenFit = typeof SummaryScreenFit.Type

// NOTE: the average frame time of the run's active frames, bucketed so a
// summary says how smooth the game felt without fingerprinting the device.
export const FrameTimeBucket = Schema.Literals([
  'Unmeasured',
  'Under10Ms',
  'Under17Ms',
  'Under25Ms',
  'Under34Ms',
  'Over34Ms',
])
export type FrameTimeBucket = typeof FrameTimeBucket.Type

export const CauseOfDeath = Schema.Literals([
  'Shambler',
  'Runner',
  'Tank',
  'Exploder',
  'Thrower',
  'Crawler',
  'Boss',
  'Unknown',
])
export type CauseOfDeath = typeof CauseOfDeath.Type

export const UNKNOWN_CAUSE: CauseOfDeath = 'Unknown'

export const WonRun = Schema.TaggedStruct('Victory', {})

export const LostRun = Schema.TaggedStruct('GameOver', {
  killedBy: CauseOfDeath,
})

export const QuitRun = Schema.TaggedStruct('Quit', {})

export const RunOutcome = Schema.Union([WonRun, LostRun, QuitRun])
export type RunOutcome = typeof RunOutcome.Type

const MAX_COUNT = 1_000_000
const MAX_WAVE = 10_000
const MAX_RUN_MS = 24 * 60 * 60 * 1000

const Count = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_COUNT }),
)

export const SummaryKills = Schema.Struct({
  Shambler: Count,
  Runner: Count,
  Tank: Count,
  Exploder: Count,
  Thrower: Count,
  Crawler: Count,
  Boss: Count,
})
export type SummaryKills = typeof SummaryKills.Type

export const VISIT_ID_LENGTH = 16

const VisitId = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/))

const MAX_BUILD_LENGTH = 96

const BuildId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_BUILD_LENGTH),
)

// NOTE: nothing in a summary identifies a person. visitId is random per page
// visit, made in a Command, and only groups one visit's runs.
export const RunSummary = Schema.Struct({
  version: Schema.Literal(RUN_SUMMARY_VERSION),
  visitId: VisitId,
  build: BuildId,
  mode: SummaryMode,
  difficulty: Difficulty,
  wave: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_WAVE })),
  outcome: RunOutcome,
  runMs: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_RUN_MS }),
  ),
  kills: SummaryKills,
  heartsLost: Count,
  purchases: Count,
  powerUpsGrabbed: Count,
  trapsPlaced: Count,
  device: SummaryDevice,
  screenFit: SummaryScreenFit,
  frameTime: FrameTimeBucket,
})
export type RunSummary = typeof RunSummary.Type

export const RunSummaryJson = Schema.fromJsonString(RunSummary)

export const RUNS_PATH = '/api/runs'

// SHARE EVENT

// NOTE: a tap on SHARE to X, counted apart from the run, since the run's
// summary is sent the moment it ends, before the end card shows. It says
// which end screen it came from and what the run was, and nothing about
// who: the same visitId as the summaries, and no text of the post.
// NOTE: version 2 adds `path`: the share sheet or X's intent link. The
// Worker still takes version 1 from a build cached before it.
export const SHARE_EVENT_VERSION = 2

export const ShareScreen = Schema.Literals([
  'Death',
  'Victory',
  'CoopDeath',
  'CoopVictory',
])
export type ShareScreen = typeof ShareScreen.Type

export const SharePath = Schema.Literals(['Sheet', 'Link'])
export type SharePath = typeof SharePath.Type

export const ShareEvent = Schema.Struct({
  version: Schema.Literal(SHARE_EVENT_VERSION),
  visitId: VisitId,
  build: BuildId,
  screen: ShareScreen,
  mode: SummaryMode,
  difficulty: Difficulty,
  path: SharePath,
})
export type ShareEvent = typeof ShareEvent.Type

export const ShareEventV1 = Schema.Struct({
  version: Schema.Literal(1),
  visitId: VisitId,
  build: BuildId,
  screen: ShareScreen,
  mode: SummaryMode,
  difficulty: Difficulty,
})
export type ShareEventV1 = typeof ShareEventV1.Type

export const ShareEventJson = Schema.fromJsonString(ShareEvent)

// NOTE: what the Worker takes: this version, or version 1 with no path.
export const PostedShareJson = Schema.fromJsonString(
  Schema.Union([ShareEvent, ShareEventV1]),
)

export const SHARES_PATH = '/api/shares'

export const HEALTH_PATH = '/api/health'
