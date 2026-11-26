import { Array, Function, Option, String } from 'effect'

import { type Lobby, NetStats } from '@munch/netcode'

import type { Model } from '#app/model.ts'
import { isBotCrew } from '#domain/bots.ts'
import { effectiveModifiersOf, playedMarkOf } from '#domain/onlineRun.ts'
import { isInRun } from '#domain/run.ts'
import type { Difficulty } from '#shared/playerData.ts'
import { dareItemsFoundOf } from '#world/dare/dare.ts'
import { isCoop, leadSeatOf, playersOf } from '#world/party/party.ts'
import { maskOfModifiers } from '#world/run/modifiers.ts'
import {
  CaseState,
  Phase,
  RunMode,
  type RunStats,
} from '#world/schema/worldSchema.ts'
import { roundWave } from '#world/waves/waves.ts'

import {
  CREW_RUN_KEY_LENGTH,
  type CrewNetwork,
  EscapedRun,
  type FrameTimeBucket,
  LeftEarlyRun,
  LostRun,
  MAX_CORRECTION_PX,
  MAX_NET_MS,
  QuitRun,
  RUN_SUMMARY_VERSION,
  type RunOutcome,
  type RunSummary,
  SHARE_EVENT_VERSION,
  SOLO_PARTY,
  type ShareEvent,
  type SharePath,
  type ShareScreen,
  type SummaryParty,
  type SummaryScreenFit,
  UNKNOWN_CAUSE,
} from './analytics.ts'
import type { ScreenFit } from './deviceSchema.ts'

const SMOOTH_MS = 10
const SIXTY_MS = 17
const FORTY_MS = 25
const THIRTY_MS = 34

export const frameTimeBucket = ({
  activeFrames,
  activeFrameMs,
}: RunStats): FrameTimeBucket => {
  if (activeFrames <= 0) {
    return 'Unmeasured'
  }

  const averageMs = activeFrameMs / activeFrames
  if (averageMs < SMOOTH_MS) {
    return 'Under10Ms'
  } else if (averageMs < SIXTY_MS) {
    return 'Under17Ms'
  } else if (averageMs < FORTY_MS) {
    return 'Under25Ms'
  } else if (averageMs < THIRTY_MS) {
    return 'Under34Ms'
  } else {
    return 'Over34Ms'
  }
}

const summaryScreenFit = (screenFit: ScreenFit): SummaryScreenFit =>
  screenFit === 'Installed' ? 'Installed' : 'Browser'

export const maybeRunOutcome: {
  (after: Model): (before: Model) => Option.Option<RunOutcome>
  (before: Model, after: Model): Option.Option<RunOutcome>
} = Function.dual(
  2,
  (before: Model, after: Model): Option.Option<RunOutcome> => {
    if (!isInRun(before.phase)) {
      return Option.none()
    }

    return Phase.match(after.phase, {
      Ready: () => Option.some(QuitRun.make({})),
      Arriving: () => Option.some(QuitRun.make({})),
      Preparation: () => Option.none(),
      Wave: () => Option.none(),
      Paused: () => Option.none(),
      Escaped: () => Option.some(EscapedRun.make({})),
      LeftEarly: () => Option.some(LeftEarlyRun.make({})),
      GameOver: () =>
        Option.some(
          LostRun.make({
            killedBy: Option.getOrElse(
              after.stats.maybeLastHurtBy,
              () => UNKNOWN_CAUSE,
            ),
          }),
        ),
    })
  },
)

const finalRun = (before: Model, after: Model, outcome: RunOutcome): Model =>
  outcome._tag === 'Quit' ? before : after

const HALF_KEY_LENGTH = CREW_RUN_KEY_LENGTH / 2
const HEX = 16

const hashKey = (text: string): string => {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (let index = 0; index < text.length; index++) {
    const code = Option.getOrElse(String.charCodeAt(text, index), () => 0)
    first = Math.imul(first ^ code, 0x9e3779b1)
    second = Math.imul(second ^ code, 0x5f356495)
  }
  first = Math.imul(first ^ (first >>> 16), 0x85ebca6b)
  first ^= Math.imul(second ^ (second >>> 13), 0xc2b2ae35)
  second = Math.imul(second ^ (second >>> 16), 0x85ebca6b)
  second ^= Math.imul(first ^ (first >>> 13), 0xc2b2ae35)
  const lane = (value: number): string =>
    String.padStart(HALF_KEY_LENGTH, '0')((value >>> 0).toString(HEX))
  return `${lane(second)}${lane(first)}`
}

export const crewRunKeyOf = (lobby: Lobby): string =>
  hashKey(`${lobby.code}:${lobby.createdMs}:${lobby.round}`)

const ownRunKey = (visitId: string, run: Model): string =>
  hashKey(`visit:${visitId}:${run.stats.runMs}`)

const atMost = (most: number, value: number): number =>
  Math.min(most, Math.max(0, Math.round(value)))

const networkOf = (run: Model): CrewNetwork => {
  const report = NetStats.clientNetReportOf(
    Option.getOrElse(run.roomRun.maybeRunNet, () => NetStats.emptyClientNet),
  )
  return {
    ...report,
    rttP50Ms: atMost(MAX_NET_MS, report.rttP50Ms),
    rttP95Ms: atMost(MAX_NET_MS, report.rttP95Ms),
    jitterMs: atMost(MAX_NET_MS, report.jitterMs),
    lateMsMean: atMost(MAX_NET_MS, report.lateMsMean),
    lateMsMax: atMost(MAX_NET_MS, report.lateMsMax),
    correctionPxMax: atMost(MAX_CORRECTION_PX, report.correctionPxMax),
  }
}

const partyOf = (run: Model, visitId: string): SummaryParty => {
  if (!isCoop(run) || isBotCrew(run)) {
    return SOLO_PARTY
  }
  const seat = leadSeatOf(run)
  return {
    _tag: 'Crew',
    size: playersOf(run).length,
    seatKills: seat.kills,
    seatDowns: seat.downs,
    seatRevives: seat.revives,
    runKey: Option.getOrElse(run.roomRun.maybeCrewRunKey, () =>
      ownRunKey(visitId, run),
    ),
    network: networkOf(run),
  }
}

const casesOpenedOf = (run: Model): number =>
  Array.filter(run.cases, ({ state }) =>
    CaseState.isAnyOf(['Opened', 'Emptied'])(state),
  ).length

export const playedDifficultyOf = (run: Model): Difficulty =>
  Option.getOrElse(run.roomRun.maybeRoomDifficulty, () => run.difficulty.chosen)

export const runSummaryOf: {
  (
    after: Model,
    outcome: RunOutcome,
    visitId: string,
    build: string,
  ): (before: Model) => RunSummary
  (
    before: Model,
    after: Model,
    outcome: RunOutcome,
    visitId: string,
    build: string,
  ): RunSummary
} = Function.dual(
  5,
  (
    before: Model,
    after: Model,
    outcome: RunOutcome,
    visitId: string,
    build: string,
  ): RunSummary => {
    const run = finalRun(before, after, outcome)
    const { stats } = run
    return {
      version: RUN_SUMMARY_VERSION,
      visitId,
      build,
      mode: RunMode.isAnyOf(['Endless'])(run.mode) ? 'Endless' : 'Campaign',
      difficulty: playedDifficultyOf(run),
      wave: roundWave(run.phase),
      outcome,
      runMs: Math.round(stats.runMs),
      kills: stats.kills,
      heartsLost: stats.heartsLost,
      keysSpent: run.keys.spent,
      casesOpened: casesOpenedOf(run),
      powerUpsGrabbed: stats.powerUpsGrabbed,
      trapsPlaced: stats.trapsPlaced,
      device: run.lastDevice,
      screenFit: summaryScreenFit(run.settings.screenFit),
      frameTime: frameTimeBucket(stats),
      party: partyOf(run, visitId),
      modifiers: maskOfModifiers(effectiveModifiersOf(run)),
      dareItemsFound: dareItemsFoundOf(run),
      dareMark: playedMarkOf(run),
    }
  },
)

type ShareEnding = 'Escaped' | 'LeftEarly' | 'Death'

const SHARE_SCREENS: Readonly<
  Record<ShareEnding, Readonly<{ solo: ShareScreen; crew: ShareScreen }>>
> = {
  Escaped: { solo: 'Escaped', crew: 'CoopEscaped' },
  LeftEarly: { solo: 'LeftEarly', crew: 'CoopLeftEarly' },
  Death: { solo: 'Death', crew: 'CoopDeath' },
}

const shareEndingOf = (phase: Phase): ShareEnding =>
  Phase.matchOrElse(
    phase,
    {
      Escaped: (): ShareEnding => 'Escaped',
      LeftEarly: (): ShareEnding => 'LeftEarly',
    },
    (): ShareEnding => 'Death',
  )

const shareScreenOf = (phase: Phase, isCrew: boolean): ShareScreen => {
  const screens = SHARE_SCREENS[shareEndingOf(phase)]
  return isCrew ? screens.crew : screens.solo
}

export const shareEventOf: {
  (
    visitId: string,
    build: string,
    played: Difficulty,
    path: SharePath,
  ): (model: Model) => ShareEvent
  (
    model: Model,
    visitId: string,
    build: string,
    played: Difficulty,
    path: SharePath,
  ): ShareEvent
} = Function.dual(
  5,
  (
    model: Model,
    visitId: string,
    build: string,
    played: Difficulty,
    path: SharePath,
  ): ShareEvent => ({
    version: SHARE_EVENT_VERSION,
    visitId,
    build,
    screen: shareScreenOf(model.phase, isCoop(model) && !isBotCrew(model)),
    mode: RunMode.isAnyOf(['Endless'])(model.mode) ? 'Endless' : 'Campaign',
    difficulty: played,
    path,
  }),
)
