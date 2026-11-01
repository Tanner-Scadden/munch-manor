import { Effect, Option, pipe } from 'effect'
import { Update } from 'foldkit'

import { RunSummary } from '../analytics'
import { maybeRunOutcome, runSummaryOf } from '../analyticsRun'
import { makeCommand } from '../definition'
import { noteRecords, reachRecords } from '../endBeat'
import { countRunFrom, forgetNewEntriesFrom } from '../home'
import { Message } from '../message'
import type { Model } from '../model'
import { cueMusicFrom } from '../musicPlan'
import { runDifficultyOf } from '../onlineRun'
import { earnRank } from '../rankRun'
import { sendOrQueueRunSummary } from '../summaryQueue'
import { RUNNING_BUILD } from '../version'
import {
  focusEndMenuFrom,
  settleNightmareFrom,
  unlockNightmareFrom,
} from './home'
import { applyRotationFrom } from './rotation'
import { writeSaveFrom } from './save'
import type { UpdateStep } from './step'

// COMMAND

export const SendRunSummary = makeCommand('SendRunSummary', {
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

// NOTE: what the root does after any change, comparing the Model from
// before it: music for the phase, the end menu's focus, the rotation lock,
// Nightmare, the run count and its summary, the new zombie badges, and the
// save. Each looks only at the root's own fields, so a child Message that
// changes nothing but its child needs none of them.
export const afterMessage = (
  before: Model,
  saveWrite: SaveWrite = 'Write',
): ReadonlyArray<UpdateStep> => [
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
  writeSaveFrom(before, saveWrite),
]

// NOTE: a synced save is taken from the store, so writing it back would
// echo it. Its Messages pass `Synced`.
export type SaveWrite = 'Write' | 'Synced'

// NOTE: one root change, then the after-message Steps. Every root handler
// and every OutMessage fold in src/composition.ts ends with them, once. A
// Step that uses a Binding (opening a dialog, a co-op operation) needs the
// handler's own Model, so its handler spells the same thing out:
// `Update.combineSteps(model, [step, ...afterMessage(model)])`. A fold
// that runs inside a handler (a dialog the handler closes) settles again,
// which only matters if the fold changes what the save, the music, or the
// run count read; none does (see "Blocks and Bindings" in AGENTS.md).
export const settled =
  (step: UpdateStep, saveWrite: SaveWrite = 'Write'): UpdateStep =>
  before =>
    Update.combineSteps(before, [step, ...afterMessage(before, saveWrite)])
