import { Array, Effect, Function, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { runDifficultyOf } from '#domain/onlineRun.ts'
import { isEndScreen } from '#domain/run.ts'
import { isOpen as isCoopOpen } from '#features/coop/update.ts'
import {
  TIMELINES,
  beatSounds,
  dismissUnlock,
  dropRunCard,
  endKindOf,
  isBeatOver,
  isRunCardHeld,
  sharePathOf,
  skipBeat,
} from '#features/end/endBeat.ts'
import { endOffer } from '#features/end/endOffer.ts'
import type { ShareOutcome } from '#features/end/share.ts'
import {
  isCharacterKey,
  isEndlessKey,
  isLobbyKey,
  isMenuKey,
  isStartKey,
} from '#input/input.ts'
import { ShareEvent } from '#platform/analytics/analytics.ts'
import { sendShareEvent } from '#platform/analytics/analyticsBeacon.ts'
import { shareEventOf } from '#platform/analytics/analyticsRun.ts'
import { RUNNING_BUILD } from '#platform/version.ts'
import { advanceJuice } from '#render/effects/juice.ts'
import { advanceParticles } from '#render/particles/particles.ts'
import { stepWhen } from '#shared/stepWhen.ts'
import { RunMode } from '#world/schema/worldSchema.ts'

import { leaveCoopRoom, toggleCoopReady } from './coop.ts'
import { startFromButton, startWhenAllowed } from './run.ts'
import { playSounds, uiCue, unlockAudio } from './sound.ts'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  toModel,
} from './step.ts'

const MS_PER_SECOND = 1000

const SLOW_MOTION_RATE = 0.3
const STAMP_TRAUMA = 0.7

export const advanceEndScreen =
  (frameMs: number): UpdateStep =>
  $ => {
    const model = $.model
    const fromMs = model.screenMs
    const toMs = fromMs + frameMs
    const stampAtMs = Option.match(endKindOf(model), {
      onNone: () => Number.POSITIVE_INFINITY,
      onSome: kind => TIMELINES[kind].stampAtMs,
    })
    const worldMs = toMs < stampAtMs ? frameMs * SLOW_MOTION_RATE : frameMs
    const stamped =
      fromMs < stampAtMs && toMs >= stampAtMs
        ? UiStruct.evolve(model, {
            shake: shake =>
              UiStruct.evolve(shake, {
                trauma: trauma => Math.max(trauma, STAMP_TRAUMA),
              }),
          })
        : model
    const moved = advanceJuice(
      advanceParticles(
        UiStruct.evolve(stamped, {
          screenMs: () => toMs,
          frameEvents: () => [],
        }),
        worldMs / MS_PER_SECOND,
        worldMs,
      ),
      frameMs,
      0,
    )
    return $.combine(
      toModel(moved),
      playSounds(Array.map(beatSounds(model, fromMs, toMs), uiCue)),
    )
  }

const retry = (model: Model): Model => startWhenAllowed(model, model.mode)

export const endFromKey: {
  (code: string): (model: Model) => Model
  (model: Model, code: string): Model
} = Function.dual(2, (model: Model, code: string): Model => {
  if (isStartKey(code)) {
    return retry(model)
  } else if (isEndlessKey(code)) {
    return startWhenAllowed(model, RunMode.Endless())
  } else {
    return model
  }
})

const AUDIO_KEYS: ReadonlyArray<string> = ['KeyM', 'KeyN']

const isEndActionKey = (code: string): boolean =>
  isCharacterKey(code) ||
  isStartKey(code) ||
  isEndlessKey(code) ||
  isMenuKey(code) ||
  Array.contains(AUDIO_KEYS, code)

export const isBeatSkipKey: {
  (code: string): (model: Model) => boolean
  (model: Model, code: string): boolean
} = Function.dual(
  2,
  (model: Model, code: string): boolean =>
    isEndScreen(model.phase) &&
    !isBeatOver(model) &&
    (endOffer(model) === 'Nothing' || !isEndActionKey(code)),
)

export const skipFromPointer = (model: Model): Model =>
  isEndScreen(model.phase)
    ? isBeatOver(model)
      ? dismissUnlock(model)
      : skipBeat(model)
    : model

const isRunCardOffered = (model: Model): boolean =>
  isCoopOpen(model.coop) && endOffer(model) !== 'Nothing'

const playAgain: UpdateStep = stepWhen(
  isRunCardOffered,
  combine([modelStep(skipBeat), toggleCoopReady]),
)

const toRoomLobby: UpdateStep = stepWhen(
  isRunCardOffered,
  modelStep(dropRunCard),
)

const leaveRoomFromCard: UpdateStep = stepWhen(isRunCardOffered, leaveCoopRoom)

export const isRunCardKey = (model: Model): boolean =>
  isCoopOpen(model.coop) && isEndScreen(model.phase) && isRunCardHeld(model)

export const runCardFromKey =
  (code: string): UpdateStep =>
  $ => {
    if (Array.contains(AUDIO_KEYS, code)) {
      return $.model
    } else if (!isRunCardOffered($.model)) {
      return skipBeat($.model)
    } else if (isStartKey(code)) {
      return playAgain($)
    } else if (isLobbyKey(code)) {
      return toRoomLobby($)
    } else if (isMenuKey(code)) {
      return leaveRoomFromCard($)
    } else {
      return skipBeat($.model)
    }
  }

export const SendShareEvent = Command.make(
  'SendShareEvent',
  { args: { event: ShareEvent } },
  ({ event }) =>
    sendShareEvent(event).pipe(
      Effect.asVoid,
      Effect.catch(error =>
        Effect.logWarning('send share event', error.reason),
      ),
      Effect.as(Component.noop),
    ),
)

const sendShare: UpdateStep = $ =>
  $.model.settings.shareStats === 'On'
    ? Option.match($.model.maybeVisitId, {
        onNone: () => $.model,
        onSome: visitId =>
          $.run(
            SendShareEvent.make({
              event: shareEventOf(
                $.model,
                visitId,
                RUNNING_BUILD,
                runDifficultyOf($.model),
                sharePathOf($.model),
              ),
            }),
          ),
      })
    : $.model

const shareFromButton: UpdateStep = combine([
  modelStep(skipBeat),
  stepWhen((skipped: Model) => isEndScreen(skipped.phase), sendShare),
])

const settleShare = (outcome: ShareOutcome): UpdateStep =>
  modelStep(model =>
    outcome === 'Copied'
      ? UiStruct.evolve(model, {
          endCard: UiStruct.evolve({
            maybeShareCopiedAtMs: () => Option.some(model.screenMs),
          }),
        })
      : model,
  )

export const endHandlers = defineHandlers({
  ClickedRetryButton: $ => startFromButton(retry($.model))($),

  ClickedShareButton: combine([unlockAudio, shareFromButton]),

  ClickedPlayAgainButton: combine([unlockAudio, playAgain]),

  ClickedRoomLobbyButton: combine([unlockAudio, toRoomLobby]),

  ClickedLeaveRoomButton: combine([unlockAudio, leaveRoomFromCard]),

  SettledShare: ($, { outcome }) => settleShare(outcome)($),

  CompletedDetectShareSheet: ($, { shareSheet }) =>
    $.evolve({
      endCard: UiStruct.evolve({ shareSheet: () => shareSheet }),
    }),
})
