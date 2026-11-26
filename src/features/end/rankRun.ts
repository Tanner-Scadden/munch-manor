import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { isHumanCrew } from '#domain/bots.ts'
import { effectiveModifiersOf, playedMarkOf } from '#domain/onlineRun.ts'
import { isEndScreen, isGuided, isInRun, isOnHome } from '#domain/run.ts'
import { playedDifficultyOf } from '#platform/analyticsRun.ts'
import { purseBonesAt, purseRanksBetween } from '#shared/rankCurve.ts'
import { dareItemsFoundOf } from '#world/dare/dare.ts'
import {
  type RunPayInput,
  bonesForRun,
  grantedVeteran,
  pointsForRun,
  rankOf,
  totalPointsOf,
} from '#world/heroes/rank.ts'
import { leadSeatOf } from '#world/party/party.ts'
import { runBonusPercentOf } from '#world/run/dareLadder.ts'
import { killTotal } from '#world/run/stats.ts'
import { Phase } from '#world/schema/worldSchema.ts'

import { awardsOf, crewOf } from './crewAwards.ts'

const payInputOf = (run: Model, isEnded: boolean): RunPayInput => {
  const seat = leadSeatOf(run)
  const awards =
    isEnded && isHumanCrew(run) ? awardsOf(crewOf(run), seat.slot).length : 0
  return {
    difficulty: playedDifficultyOf(run),
    wavesCleared: Math.max(
      0,
      run.stats.wavesCleared - run.runGains.rankPaid.wavesPaid,
    ),
    bossesFelled: Math.max(
      0,
      run.stats.kills.Boss - run.runGains.rankPaid.bossesPaid,
    ),
    readyPoints: Math.max(
      0,
      run.stats.readyPoints - run.runGains.rankPaid.readyPaid,
    ),
    dareItems: dareItemsFoundOf(run),
    isEscape: Phase.isAnyOf(['Escaped'])(run.phase),
    awards: Math.max(0, awards - run.runGains.rankPaid.awardsPaid),
    revives: isHumanCrew(run)
      ? Math.max(0, seat.revives - run.runGains.rankPaid.revivesPaid)
      : 0,
    bonusPercent: runBonusPercentOf(
      effectiveModifiersOf(run),
      playedMarkOf(run),
    ),
    isGuided: isGuided(run),
  }
}

const paidBy = (
  run: Model,
  isEnded: boolean,
): Model['runGains']['rankPaid'] => ({
  wavesPaid: run.stats.wavesCleared,
  bossesPaid: run.stats.kills.Boss,
  readyPaid: run.stats.readyPoints,
  awardsPaid:
    isEnded && isHumanCrew(run)
      ? awardsOf(crewOf(run), leadSeatOf(run).slot).length
      : 0,
  revivesPaid: isHumanCrew(run) ? leadSeatOf(run).revives : 0,
})

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
  const paid = UiStruct.evolve(after, {
    rank: rank =>
      UiStruct.evolve(rank, {
        earnedPoints: earned => earned + points,
        earnedBones: earned => earned + bones,
      }),
    bonuses: saved =>
      UiStruct.evolve(saved, {
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
    ? UiStruct.evolve(paid, {
        runGains: UiStruct.evolve({
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
        }),
      })
    : paid
})

const isFirstEscapeOn = (model: Model, input: RunPayInput): boolean =>
  !Array.contains(model.bonuses.escapedOn, input.difficulty)

export const grantVeteran = (model: Model): Model =>
  model.rank.isVeteranGranted
    ? model
    : UiStruct.evolve(model, {
        rank: rank => grantedVeteran(rank, killTotal(model.bests.killsByKind)),
      })

export const payPurses = (model: Model): Model => {
  const due = Array.filter(
    purseRanksBetween(0, rankOf(totalPointsOf(model.rank))),
    rank => !Array.contains(model.bonuses.purses, rank),
  )
  return Array.isReadonlyArrayEmpty(due)
    ? model
    : UiStruct.evolve(model, {
        rank: rank =>
          UiStruct.evolve(rank, {
            earnedBones: earned =>
              earned +
              Array.reduce(
                due,
                0,
                (total, purseRank) =>
                  total + Option.getOrElse(purseBonesAt(purseRank), () => 0),
              ),
          }),
        bonuses: bonuses =>
          UiStruct.evolve(bonuses, {
            purses: paid => [...paid, ...due],
          }),
      })
}

export const payPursesFrom: {
  (after: Model, saveWrite: 'Write' | 'Synced'): (before: Model) => Model
  (before: Model, after: Model, saveWrite: 'Write' | 'Synced'): Model
} = Function.dual(
  3,
  (before: Model, after: Model, saveWrite: 'Write' | 'Synced'): Model =>
    saveWrite === 'Write' &&
    after.saving.saveStatus === 'Read' &&
    rankOf(totalPointsOf(after.rank)) > rankOf(totalPointsOf(before.rank))
      ? payPurses(after)
      : after,
)
