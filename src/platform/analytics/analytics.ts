import { Schema } from 'effect'

import { Difficulty } from '#shared/records/playerData.ts'

export const RUN_SUMMARY_VERSION = 9

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

export const SummaryDevice = Schema.Literals([
  'KeyboardMouse',
  'Touch',
  'Gamepad',
])
export type SummaryDevice = typeof SummaryDevice.Type

const SummaryDeviceV5 = Schema.Literals(['KeyboardMouse', 'Touch'])

export const SummaryScreenFit = Schema.Literals(['Browser', 'Installed'])
export type SummaryScreenFit = typeof SummaryScreenFit.Type

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

export const EscapedRun = Schema.TaggedStruct('Escaped', {})

const WonRun = Schema.TaggedStruct('Victory', {})

export const LostRun = Schema.TaggedStruct('GameOver', {
  killedBy: CauseOfDeath,
})

export const QuitRun = Schema.TaggedStruct('Quit', {})

export const LeftEarlyRun = Schema.TaggedStruct('LeftEarly', {})

export const RunOutcome = Schema.Union([
  EscapedRun,
  LeftEarlyRun,
  LostRun,
  QuitRun,
])
export type RunOutcome = typeof RunOutcome.Type

const RunOutcomeV7 = Schema.Union([EscapedRun, LostRun, QuitRun])

const RunOutcomeV4 = Schema.Union([WonRun, LostRun, QuitRun])

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

export const MAX_CREW_SIZE = 4

const SoloParty = Schema.TaggedStruct('Solo', {})

const crewFields = {
  size: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_CREW_SIZE }),
  ),
  seatKills: Count,
  seatDowns: Count,
  seatRevives: Count,
}

export const CREW_RUN_KEY_LENGTH = 16

const CrewRunKey = Schema.String.check(Schema.isPattern(/^[0-9a-f]{16}$/))

const CrewPartyV6 = Schema.TaggedStruct('Crew', {
  ...crewFields,
  runKey: CrewRunKey,
})

const SummaryPartyV6 = Schema.Union([SoloParty, CrewPartyV6])
export type SummaryPartyV6 = typeof SummaryPartyV6.Type

export const MAX_NET_MS = 60_000
export const MAX_CORRECTION_PX = 100_000

const NetMs = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: MAX_NET_MS }),
)

export const CrewNetwork = Schema.Struct({
  rttP50Ms: NetMs,
  rttP95Ms: NetMs,
  rttSamples: Count,
  jitterMs: NetMs,
  snapshots: Count,
  lateSnapshots: Count,
  lateMsMean: NetMs,
  lateMsMax: NetMs,
  reconnects: Count,
  corrections: Count,
  correctionPxMax: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_CORRECTION_PX }),
  ),
})
export type CrewNetwork = typeof CrewNetwork.Type

const CrewParty = Schema.TaggedStruct('Crew', {
  ...crewFields,
  runKey: CrewRunKey,
  network: CrewNetwork,
})

export const SummaryParty = Schema.Union([SoloParty, CrewParty])
export type SummaryParty = typeof SummaryParty.Type

const CrewPartyV2 = Schema.TaggedStruct('Crew', crewFields)

const SummaryPartyV2 = Schema.Union([SoloParty, CrewPartyV2])
export type SummaryPartyV2 = typeof SummaryPartyV2.Type

export const SOLO_PARTY: SummaryParty = SoloParty.make({})

const baseFields = {
  visitId: VisitId,
  build: BuildId,
  mode: SummaryMode,
  difficulty: Difficulty,
  wave: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_WAVE })),
  outcome: RunOutcomeV4,
  runMs: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_RUN_MS }),
  ),
  kills: SummaryKills,
  heartsLost: Count,
  powerUpsGrabbed: Count,
  trapsPlaced: Count,
  device: SummaryDeviceV5,
  screenFit: SummaryScreenFit,
  frameTime: FrameTimeBucket,
}

const runFields = { ...baseFields, purchases: Count }

const ModifierMask = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 15 }),
)

const escapeFields = {
  ...baseFields,
  outcome: RunOutcomeV7,
  keysSpent: Count,
  casesOpened: Count,
  dareItemsFound: Count,
  party: SummaryPartyV6,
  modifiers: ModifierMask,
}

const SummaryDareMark = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 8 }),
)

export const RunSummary = Schema.Struct({
  version: Schema.Literal(RUN_SUMMARY_VERSION),
  ...escapeFields,
  outcome: RunOutcome,
  device: SummaryDevice,
  party: SummaryParty,
  dareMark: SummaryDareMark,
})
export type RunSummary = typeof RunSummary.Type

const RunSummaryV8 = Schema.Struct({
  version: Schema.Literal(8),
  ...escapeFields,
  outcome: RunOutcome,
  device: SummaryDevice,
  party: SummaryParty,
})

const RunSummaryV7 = Schema.Struct({
  version: Schema.Literal(7),
  ...escapeFields,
  device: SummaryDevice,
  party: SummaryParty,
})

const RunSummaryV6 = Schema.Struct({
  version: Schema.Literal(6),
  ...escapeFields,
  device: SummaryDevice,
})

const RunSummaryV5 = Schema.Struct({
  version: Schema.Literal(5),
  ...escapeFields,
})

const RunSummaryV4 = Schema.Struct({
  version: Schema.Literal(4),
  ...runFields,
  party: SummaryPartyV6,
  modifiers: ModifierMask,
})

const RunSummaryV3 = Schema.Struct({
  version: Schema.Literal(3),
  ...runFields,
  party: SummaryPartyV6,
})
type RunSummaryV3 = typeof RunSummaryV3.Type

export const RunSummaryV2 = Schema.Struct({
  version: Schema.Literal(2),
  ...runFields,
  party: SummaryPartyV2,
})
export type RunSummaryV2 = typeof RunSummaryV2.Type

export const RunSummaryV1 = Schema.Struct({
  version: Schema.Literal(1),
  ...runFields,
})
export type RunSummaryV1 = typeof RunSummaryV1.Type

export const PostedRunSummary = Schema.Union([
  RunSummary,
  RunSummaryV8,
  RunSummaryV7,
  RunSummaryV6,
  RunSummaryV5,
  RunSummaryV4,
  RunSummaryV3,
  RunSummaryV2,
  RunSummaryV1,
])
export type PostedRunSummary = typeof PostedRunSummary.Type

export const PostedRunJson = Schema.fromJsonString(PostedRunSummary)

export const RunSummaryJson = Schema.fromJsonString(RunSummary)

export const RUNS_PATH = '/api/runs'

export const SHARE_EVENT_VERSION = 2

export const ShareScreen = Schema.Literals([
  'Death',
  'Escaped',
  'LeftEarly',
  'CoopDeath',
  'CoopEscaped',
  'CoopLeftEarly',
  'Victory',
  'CoopVictory',
])
export type ShareScreen = typeof ShareScreen.Type

export const SharePath = Schema.Literals(['Sheet', 'Copy', 'Link'])
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

export const PostedShareJson = Schema.fromJsonString(
  Schema.Union([ShareEvent, ShareEventV1]),
)

export const SHARES_PATH = '/api/shares'

export const HEALTH_PATH = '/api/health'
