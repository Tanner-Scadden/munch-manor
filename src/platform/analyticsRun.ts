import { Function, Option, String } from 'effect'

import type { Lobby } from '@munch/netcode'

import type { Model } from '../app/model'
import { isBotCrew } from '../features/bots/bots'
import { isInRun } from '../features/home/home'
import { effectiveModifiersOf } from '../features/onlineRun/onlineRun'
import type { Difficulty } from '../shared/playerData'
import { isCoop, leadSeatOf, playersOf } from '../world/party/party'
import { maskOfModifiers } from '../world/run/modifiers'
import { Phase, RunMode, type RunStats } from '../world/schema/worldSchema'
import { roundWave } from '../world/waves/waves'
import {
  CREW_RUN_KEY_LENGTH,
  type FrameTimeBucket,
  LostRun,
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
  WonRun,
} from './analytics'
import type { ScreenFit } from './deviceSchema'

// FRAME TIME

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

// RUN END

// NOTE: a run ends at Game Over, at Victory, or when the player leaves it:
// from the pause MENU, or, online, by leaving the room or losing it, which
// goes home (src/app/update/coop.ts, leftRoom). Keeping going after a win
// starts no new run: when that run ends it reports again, as Endless, with
// the whole run's stats.
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
      Preparation: () => Option.none(),
      Wave: () => Option.none(),
      Paused: () => Option.none(),
      Victory: () => Option.some(WonRun.make({})),
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

// NOTE: leaving a run resets the Model's run, so a Quit is read from the
// Model just before it. Game Over and Victory keep the run until the next.
const finalRun = (before: Model, after: Model, outcome: RunOutcome): Model =>
  outcome._tag === 'Quit' ? before : after

// CREW RUN KEY

const HALF_KEY_LENGTH = CREW_RUN_KEY_LENGTH / 2
const HEX = 16

// NOTE: a deterministic 64 bit string hash (two 32 bit lanes, mixed at the
// end), not cryptographic: it only has to keep different runs apart.
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

// NOTE: one online co-op run's key, alike on every client in it, from the
// room's lobby as its replica has it: the code, when the room was made,
// and the round, which each start (RUN IT BACK and KEEP GOING too) counts
// up. A code used again later is another room made at another time. Only
// the hash is sent, so a summary names no room. A run is drawn only once
// the lobby has left its Lobby status for the round (src/features/onlineRun/onlineRun.ts,
// maybeRunRoom), so a replica a round behind never keys it.
export const crewRunKeyOf = (lobby: Lobby): string =>
  hashKey(`${lobby.code}:${lobby.createdMs}:${lobby.round}`)

// NOTE: a crew run that never drew a room's lobby (couch play, `?local=N`)
// is keyed by its own visit and length, so the report counts it alone.
const ownRunKey = (visitId: string, run: Model): string =>
  hashKey(`visit:${visitId}:${run.stats.runMs}`)

// NOTE: a run with teammate bots reports as Solo: it is one human's run, and
// the crew numbers are for humans (a bot count in the summary would be a
// RUN_SUMMARY_VERSION bump and a D1 migration, left for later). An online co-op run's own seat is the lead in the Model (the
// client draws it as the player, src/features/onlineRun/coopPlay.ts), so its numbers are this
// player's. The crew's size counts every seat in the run, one who dropped
// out too.
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
    runKey: Option.getOrElse(run.maybeCrewRunKey, () =>
      ownRunKey(visitId, run),
    ),
  }
}

// NOTE: an online run plays on the room's difficulty, kept with the run
// (maybeRoomDifficulty) so a LEAVE, which drops the room, still has it.
export const playedDifficultyOf = (run: Model): Difficulty =>
  Option.getOrElse(run.maybeRoomDifficulty, () => run.difficulty.chosen)

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
      purchases: stats.purchases,
      powerUpsGrabbed: stats.powerUpsGrabbed,
      trapsPlaced: stats.trapsPlaced,
      device: run.lastDevice,
      screenFit: summaryScreenFit(run.screenFit),
      frameTime: frameTimeBucket(stats),
      party: partyOf(run, visitId),
      modifiers: maskOfModifiers(effectiveModifiersOf(run)),
    }
  },
)

// SHARE

const shareScreenOf = (isWon: boolean, isCrew: boolean): ShareScreen => {
  if (isCrew) {
    return isWon ? 'CoopVictory' : 'CoopDeath'
  } else {
    return isWon ? 'Victory' : 'Death'
  }
}

// NOTE: a tap on SHARE as its event: which end screen, a crew's or one
// player's, and the run's mode and difficulty. `played` is the run's
// difficulty, the room's in an online co-op run.
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
    screen: shareScreenOf(
      Phase.isAnyOf(['Victory'])(model.phase),
      isCoop(model) && !isBotCrew(model),
    ),
    mode: RunMode.isAnyOf(['Endless'])(model.mode) ? 'Endless' : 'Campaign',
    difficulty: played,
    path,
  }),
)
