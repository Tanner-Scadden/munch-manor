import { Effect, Function, Option, pipe } from 'effect'

import { keepJournal, tallyJournalFrom } from '../../domain/journal'
import { runDifficultyOf } from '../../domain/onlineRun'
import { noteDeathTip } from '../../features/end/deathTip'
import { noteRecords, reachRecords } from '../../features/end/endBeat'
import { earnRank } from '../../features/end/rankRun'
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
import { sendOrQueueRunSummary } from '../../platform/summaryQueue'
import { RUNNING_BUILD } from '../../platform/version'
import { countRunFrom, forgetNewEntriesFrom } from '../../screens/home/home'
import { ApplicationBlock } from '../definition'
import { Message } from '../message'
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
import type { UpdateStep } from './step'

// COMMAND

export const SendRunSummary = ApplicationBlock.makeCommand('SendRunSummary', {
  args: { summary: RunSummary },
  messages: [Message.CompletedSendRunSummary, Message.FailedSendRunSummary],
  handler: function* () {
    return ({ summary }) =>
      pipe(
        sendOrQueueRunSummary(summary),
        Effect.as(Message.CompletedSendRunSummary()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSendRunSummary({ reason: error.reason }),
          ),
        ),
      )
  },
})

// ANALYTICS

// NOTE: the summary is built here from the Model, so update stays pure. The
// visit id comes from GenerateVisitId and the build id is a build constant.
// An online co-op run sends its own the same way: each player's client
// sends one from its own seat, by its own sharing setting.
const sendRunSummaryFrom =
  (before: Model): UpdateStep =>
  stepModel => {
    if (stepModel.shareStats === 'Off') {
      return { model: stepModel }
    }

    return Option.match(
      Option.all([maybeRunOutcome(before, stepModel), stepModel.maybeVisitId]),
      {
        onNone: () => ({ model: stepModel }),
        onSome: ([outcome, visitId]) => ({
          model: stepModel,
          commands: [
            SendRunSummary({
              summary: runSummaryOf(
                before,
                stepModel,
                outcome,
                visitId,
                RUNNING_BUILD,
              ),
            }),
          ],
        }),
      },
    )
  }

// AFTER A MESSAGE

// NOTE: a synced save is taken from the store, so writing it back would
// echo it. Its Messages settle with `Synced`.
type SaveWrite = 'Write' | 'Synced'

// NOTE: what the root does after any change, comparing the Model from
// before it: music for the phase, the end menu's focus, the rotation lock,
// Nightmare, the rank and the daily missions a run pays, the Proof Shelf, the Dare Journal and its milestones, the death tip, how the run ended and the friends' line for the
// next intro, the run count and its summary, the run's recording, the new
// zombie badges, the
// fridge prizes pulled, and the save. `update` in src/app/main.ts runs them once
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
    stepModel => ({ model: freezeMissionsFrom(stepModel, before) }),
    stepModel => ({ model: tallyMissionsFrom(before, stepModel) }),
    stepModel => ({ model: tallyJournalFrom(before, stepModel) }),
    stepModel => ({
      model: earnRank(before, stepModel),
    }),
    stepModel => ({ model: payMissions(before, stepModel) }),
    stepModel => ({ model: shelveRun(before, stepModel) }),
    stepModel => ({ model: keepJournal(before, stepModel) }),
    stepModel => ({
      model: noteDeathTip(before, stepModel, runDifficultyOf(stepModel)),
    }),
    stepModel => ({
      model: pickCarLine(before, noteRunEnding(before, stepModel)),
    }),
    stepModel => ({
      model: countRunFrom(
        before,
        reachRecords(
          before,
          noteRecords(before, stepModel, runDifficultyOf(stepModel)),
          runDifficultyOf(stepModel),
        ),
        runDifficultyOf(stepModel),
      ),
    }),
    sendRunSummaryFrom(before),
    finishRecordingFrom(before),
    stepModel => ({ model: forgetNewEntriesFrom(before, stepModel) }),
    stepModel => ({ model: notePulledPrize(stepModel) }),
    writeSaveFrom(before, saveWrite),
  ],
)
