import { Effect, Function, Option, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import { climbLadder, fitDareMark } from '../../domain/dareMarks'
import { keepJournal, tallyJournalFrom } from '../../domain/journal'
import { fitPropStyle } from '../../domain/mastery'
import { runDifficultyOf } from '../../domain/onlineRun'
import { noteDeathTip } from '../../features/end/deathTip'
import { noteRecords, reachRecords } from '../../features/end/endBeat'
import { earnMastery } from '../../features/end/masteryRun'
import { earnRank, payPursesFrom } from '../../features/end/rankRun'
import { notePulledPrize } from '../../features/guide/shopGuide'
import { noteRunEnding, pickCarLine } from '../../features/intro/carLine'
import {
  freezeMissionsFrom,
  payMissions,
  tallyMissionsFrom,
} from '../../features/missions/missions'
import { shelveRun } from '../../features/proof/proof'
import { RunSummary } from '../../platform/analytics'
import { maybeRunOutcome, runSummaryOf } from '../../platform/analyticsRun'
import { PlayerStore } from '../../platform/store'
import { sendOrQueueRunSummary } from '../../platform/summaryQueue'
import { RUNNING_BUILD } from '../../platform/version'
import { countRunFrom, forgetNewEntriesFrom } from '../../screens/home/home'
import type { Model } from '../model'
import {
  focusEndMenuFrom,
  settleNightmareFrom,
  unlockNightmareFrom,
} from './home'
import { cueMusicFrom } from './music'
import { finishRecordingFrom } from './recording'
import { applyRotationFrom } from './rotation'
import { writeSaveFrom } from './save'
import { type UpdateStep, modelStep } from './step'

export class SendRunSummary extends Command.Service<SendRunSummary>()(
  'app/SendRunSummary',
  { args: { summary: RunSummary }, success: Component.Noop },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return ({ summary }) =>
        pipe(
          sendOrQueueRunSummary(summary),
          Effect.provideService(PlayerStore, store),
          Effect.catch(error =>
            Effect.logWarning('send run summary', error.reason),
          ),
          Effect.as(Component.noop),
        )
    }),
  )
}

const sendRunSummaryFrom =
  (before: Model): UpdateStep =>
  $ =>
    $.model.settings.shareStats === 'Off'
      ? $.model
      : Option.match(
          Option.all([maybeRunOutcome(before, $.model), $.model.maybeVisitId]),
          {
            onNone: () => $.model,
            onSome: ([outcome, visitId]) =>
              $.run(
                SendRunSummary.make({
                  summary: runSummaryOf(
                    before,
                    $.model,
                    outcome,
                    visitId,
                    RUNNING_BUILD,
                  ),
                }),
              ),
          },
        )

type SaveWrite = 'Write' | 'Synced'

export const afterMessage: {
  (saveWrite: SaveWrite): (before: Model) => ReadonlyArray<UpdateStep>
  (before: Model, saveWrite: SaveWrite): ReadonlyArray<UpdateStep>
} = Function.dual(
  2,
  (before: Model, saveWrite: SaveWrite): ReadonlyArray<UpdateStep> => [
    cueMusicFrom(before),
    focusEndMenuFrom(before),
    applyRotationFrom(before),
    settleNightmareFrom(before),
    unlockNightmareFrom(before),
    modelStep(after => freezeMissionsFrom(after, before)),
    modelStep(after => tallyMissionsFrom(before, after)),
    modelStep(after => tallyJournalFrom(before, after)),
    modelStep(after => earnMastery(before, after)),
    modelStep(after => earnRank(before, after)),
    modelStep(after => payMissions(before, after)),
    modelStep(after => payPursesFrom(before, after, saveWrite)),
    modelStep(after => shelveRun(before, after)),
    modelStep(after => fitDareMark(climbLadder(before, after))),
    modelStep(after => keepJournal(before, after)),
    modelStep(after => noteDeathTip(before, after, runDifficultyOf(after))),
    modelStep(after => pickCarLine(before, noteRunEnding(before, after))),
    modelStep(after =>
      countRunFrom(
        before,
        reachRecords(
          before,
          noteRecords(before, after, runDifficultyOf(after)),
          runDifficultyOf(after),
        ),
        runDifficultyOf(after),
      ),
    ),
    sendRunSummaryFrom(before),
    finishRecordingFrom(before),
    modelStep(after => forgetNewEntriesFrom(before, after)),
    modelStep(notePulledPrize),
    modelStep(fitPropStyle),
    writeSaveFrom(before, saveWrite),
  ],
)
