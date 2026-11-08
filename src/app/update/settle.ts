import { Effect, Function, Option, pipe } from 'effect'

import { cueMusicFrom } from '../../audio/musicPlan'
import { noteRecords, reachRecords } from '../../features/end/endBeat'
import { countRunFrom, forgetNewEntriesFrom } from '../../features/home/home'
import {
  focusEndMenuFrom,
  settleNightmareFrom,
  unlockNightmareFrom,
} from '../../features/home/update'
import { runDifficultyOf } from '../../features/onlineRun/onlineRun'
import { earnRank } from '../../features/rank/rankRun'
import { notePulledPrize } from '../../features/shop/shopGuide'
import { RunSummary } from '../../platform/analytics'
import { maybeRunOutcome, runSummaryOf } from '../../platform/analyticsRun'
import { sendOrQueueRunSummary } from '../../platform/summaryQueue'
import { RUNNING_BUILD } from '../../platform/version'
import { ApplicationBlock } from '../definition'
import { Message } from '../message'
import type { Model } from '../model'
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
// Nightmare, the run count and its summary, the new zombie badges, the
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
    stepModel => ({
      model: earnRank(before, stepModel),
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
    stepModel => ({ model: forgetNewEntriesFrom(before, stepModel) }),
    stepModel => ({ model: notePulledPrize(stepModel) }),
    writeSaveFrom(before, saveWrite),
  ],
)
