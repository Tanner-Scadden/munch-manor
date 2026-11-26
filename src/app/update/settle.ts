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

// COMMAND

// NOTE: a summary that cannot go out waits in the store's queue, so the
// Model hears nothing either way: a failure is logged.
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

// ANALYTICS

// NOTE: the summary is built here from the Model, so update stays pure. The
// visit id comes from GenerateVisitId and the build id is a build constant.
// An online co-op run sends its own the same way: each player's client
// sends one from its own seat, by its own sharing setting.
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

// AFTER A MESSAGE

// NOTE: a synced save is taken from the store, so writing it back would
// echo it. Its Messages settle with `Synced`.
type SaveWrite = 'Write' | 'Synced'

// NOTE: what the root does after any change, comparing the Model from
// before it: music for the phase, the end menu's focus, the rotation lock,
// Nightmare, hero and gun mastery, the rank, the rank purses, and the daily missions a run pays, the Proof Shelf, the dare ladder's marks opened and the pick held to them, the Dare Journal and its milestones, the death tip, how the run ended and the friends' line for the
// next intro, the run count and its summary, the run's recording, the new
// zombie badges, the
// fridge prizes pulled, the prop style fitted to the hero picked, and the save. `update` in src/app/main.ts runs them once
// after every dispatch, a child's delivery and its fold included. Each looks
// only at the root's own fields and acts on a change between the two Models,
// so a dispatch that leaves the root as it was does nothing here.
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
