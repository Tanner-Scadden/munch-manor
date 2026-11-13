import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { isBotCrew } from '../../domain/bots'
import { effectiveModifiersOf } from '../../domain/onlineRun'
import { isEndScreen, isInRun, isOnHome } from '../../domain/run'
import { playedDifficultyOf } from '../../platform/analyticsRun'
import { dareItemsFoundOf } from '../../world/dare/dare'
import {
  type RunPayInput,
  bonesForRun,
  grantedVeteran,
  pointsForRun,
  totalPointsOf,
} from '../../world/heroes/rank'
import { isCoop, leadSeatOf } from '../../world/party/party'
import { isPending } from '../../world/run/lessons'
import { bonusPercentOf } from '../../world/run/modifiers'
import { killTotal } from '../../world/run/stats'
import { Phase } from '../../world/schema/worldSchema'
import { roundWave } from '../../world/waves/waves'
import { awardsOf, crewOf } from './crewAwards'

// Reading a run into the rank it pays (src/world/heroes/rank.ts has the numbers). A run
// pays when it ends, at Game Over or an escape, and when the player leaves it
// for the menu, once each way: the same moments the run is counted in the
// bests (countRunFrom in src/screens/home/home.ts).

// NOTE: awards and revives pay only in a crew of people. Teammate bots are
// opponents for neither: a run with bots pays as a single player run does,
// so a bot never makes Bones (and a human never farms them by reviving or
// outscoring one).
const isHumanCrew = (run: Model): boolean => isCoop(run) && !isBotCrew(run)

// NOTE: a run still on the practice gate (wave 1 with the basics not yet
// tried, even paused) pays nothing: the tutorial is not a run to rank.
const isGuided = (run: Model): boolean =>
  roundWave(run.phase) === 1 &&
  (isPending(run.lessons.move) || isPending(run.lessons.fire))

// NOTE: what a run, as the Model holds it, has earned beyond what it was
// paid already (`rankPaid`): the waves cleared and bosses felled after the
// last payout, so a win that keeps going into endless pays only the
// endless part when it ends again. In an online co-op run the Model's lead
// seat is the player's own, so its revives and awards are theirs. Awards
// are the crew board's, which only a run that ended has.
const payInputOf = (run: Model, isEnded: boolean): RunPayInput => {
  const seat = leadSeatOf(run)
  const awards =
    isEnded && isHumanCrew(run) ? awardsOf(crewOf(run), seat.slot).length : 0
  return {
    difficulty: playedDifficultyOf(run),
    wavesCleared: Math.max(0, run.stats.wavesCleared - run.rankPaid.wavesPaid),
    bossesFelled: Math.max(0, run.stats.kills.Boss - run.rankPaid.bossesPaid),
    readyPoints: Math.max(0, run.stats.readyPoints - run.rankPaid.readyPaid),
    dareItems: dareItemsFoundOf(run),
    isEscape: Phase.isAnyOf(['Escaped'])(run.phase),
    awards: Math.max(0, awards - run.rankPaid.awardsPaid),
    revives: isHumanCrew(run)
      ? Math.max(0, seat.revives - run.rankPaid.revivesPaid)
      : 0,
    bonusPercent: bonusPercentOf(effectiveModifiersOf(run)),
    isGuided: isGuided(run),
  }
}

// NOTE: the player's own seat's numbers so far, to remember as paid.
const paidBy = (run: Model, isEnded: boolean): Model['rankPaid'] => ({
  wavesPaid: run.stats.wavesCleared,
  bossesPaid: run.stats.kills.Boss,
  readyPaid: run.stats.readyPoints,
  awardsPaid:
    isEnded && isHumanCrew(run)
      ? awardsOf(crewOf(run), leadSeatOf(run).slot).length
      : 0,
  revivesPaid: isHumanCrew(run) ? leadSeatOf(run).revives : 0,
})

// NOTE: pays the run that just ended, or that the player just left, into
// the saved rank. At the end screen it also sets what the end card's rank
// strip shows; leaving shows no card. A run that paid nothing because it
// was guided shows no strip.
export const earnRank: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  const isEnded = !isEndScreen(before.phase) && isEndScreen(after.phase)
  const isLeft = isInRun(before.phase) && isOnHome(after.phase)
  if (!isEnded && !isLeft) {
    return after
  }
  const run = isEnded ? after : before
  const input = payInputOf(run, isEnded)
  const points = pointsForRun(input)
  const isFirstEscape = input.isEscape && isFirstEscapeOn(after, input)
  const maybeDoubleDay = Option.filter(
    after.maybeToday,
    today => after.bonuses.doubledDay !== today,
  )
  const { bones, bonuses } = bonesForRun({
    points,
    isEnded,
    isGuided: input.isGuided,
    isFirstOfDay: Option.isSome(maybeDoubleDay),
    isFirstEscape,
  })
  const pointsBefore = totalPointsOf(after.rank)
  const paid = modifyFields(after, {
    rank: rank =>
      modifyFields(rank, {
        earnedPoints: earned => earned + points,
        earnedBones: earned => earned + bones,
      }),
    bonuses: saved =>
      modifyFields(saved, {
        doubledDay: day =>
          Array.contains(bonuses, 'Double')
            ? Option.getOrElse(maybeDoubleDay, () => day)
            : day,
        escapedOn: escaped =>
          Array.contains(bonuses, 'FirstEscape')
            ? Array.append(escaped, input.difficulty)
            : escaped,
      }),
  })
  return isEnded
    ? modifyFields(paid, {
        rankPaid: () => paidBy(run, true),
        maybeRankGain: () =>
          input.isGuided
            ? Option.none()
            : Option.some({
                pointsBefore,
                gained: points,
                bonesGained: bones,
                bonusPercent: input.bonusPercent,
                bonuses,
              }),
      })
    : paid
})

// NOTE: the first escape on a difficulty pays its bonus once: the
// difficulties escaped on since the bonus came in are saved and synced.
const isFirstEscapeOn = (model: Model, input: RunPayInput): boolean =>
  !Array.contains(model.bonuses.escapedOn, input.difficulty)

// NOTE: a save from before rank is granted its veteran start once, when
// it is first read (loadSave in src/app/update/save.ts), from the kills it
// holds. A new player, with no save, is granted 0 there too, so the kills
// they make later never become a grant.
export const grantVeteran = (model: Model): Model =>
  model.rank.isVeteranGranted
    ? model
    : modifyFields(model, {
        rank: rank => grantedVeteran(rank, killTotal(model.bests.killsByKind)),
      })
