import { Effect, Function, Option, pipe } from 'effect'

import { Command, Component } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { climbLadder, fitDareMark } from '#domain/dareMarks.ts'
import { keepJournal, tallyJournalFrom } from '#domain/journal.ts'
import { fitPropStyle } from '#domain/mastery.ts'
import { runDifficultyOf } from '#domain/onlineRun.ts'
import { noteDeathTip } from '#features/end/deathTip.ts'
import { noteRecords, reachRecords } from '#features/end/endBeat.ts'
import { earnMastery } from '#features/end/masteryRun.ts'
import { earnRank, payPursesFrom } from '#features/end/rankRun.ts'
import { notePulledPrize } from '#features/guide/shopGuide.ts'
import { noteRunEnding, pickCarLine } from '#features/intro/carLine.ts'
import {
  freezeMissionsFrom,
  payMissions,
  tallyMissionsFrom,
} from '#features/missions/missions.ts'
import { shelveRun } from '#features/proof/proof.ts'
import { RunSummary } from '#platform/analytics/analytics.ts'
import {
  maybeRunOutcome,
  runSummaryOf,
} from '#platform/analytics/analyticsRun.ts'
import { sendOrQueueRunSummary } from '#platform/analytics/summaryQueue.ts'
import { PlayerStore } from '#platform/save/store.ts'
import { RUNNING_BUILD } from '#platform/version.ts'
import { countRunFrom, forgetNewEntriesFrom } from '#screens/home/home.ts'

import {
  focusEndMenuFrom,
  settleNightmareFrom,
  unlockNightmareFrom,
} from './home.ts'
import { cueMusicFrom } from './music.ts'
import { finishRecordingFrom } from './recording.ts'
import { applyRotationFrom } from './rotation.ts'
import { writeSaveFrom } from './save.ts'
import { type UpdateStep, modelStep } from './step.ts'

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
