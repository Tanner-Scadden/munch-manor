import { Array, Effect, Function, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { CoopBinding } from '../../app/bindings'
import { ApplicationBlock, makeStep } from '../../app/definition'
import type { Model } from '../../app/model'
import { stepWhen } from '../../app/stepWhen'
import {
  keepGoingWhenAllowed,
  startFromButton,
  startWhenAllowed,
} from '../../app/update/run'
import { playSounds, uiCue, unlockAudio } from '../../app/update/sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  toModel,
  unchanged,
} from '../../app/update/step'
import {
  isCharacterKey,
  isEndlessKey,
  isKeepGoingKey,
  isLobbyKey,
  isMenuKey,
  isStartKey,
} from '../../input/input'
import { ShareEvent } from '../../platform/analytics'
import { sendShareEvent } from '../../platform/analyticsBeacon'
import { shareEventOf } from '../../platform/analyticsRun'
import { RUNNING_BUILD } from '../../platform/version'
import { advanceJuice } from '../../render/juice'
import { advanceParticles } from '../../render/particles/particles'
import { Phase, RunMode } from '../../world/schema/worldSchema'
import { isOpen as isCoopOpen } from '../coop/update'
import { endOffer, isEndScreen } from '../home/home'
import { runDifficultyOf } from '../onlineRun/onlineRun'
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
} from './endBeat'
import { EndMessage } from './message'
import type { ShareOutcome } from './share'

// The end of a run in update (the beat itself is src/features/end/endBeat.ts): its
// frame, its keys and taps, RETRY, and sharing the run.

const MS_PER_SECOND = 1000

// NOTE: until the stamp lands the gore of the last bite flies in slow
// motion, then at full speed, so it settles while the card tallies.
const SLOW_MOTION_RATE = 0.3
const STAMP_TRAUMA = 0.7

// FRAME

// NOTE: the end screen's frame. The World stands still, so the round's
// last events are spent: the particles fly on (slowly at first), the stamp
// shakes the screen, and the beat plays its sounds as the clock passes them.
export const advanceEndScreen =
  (frameMs: number): UpdateStep =>
  model => {
    const fromMs = model.screenMs
    const toMs = fromMs + frameMs
    const stampAtMs = Option.match(endKindOf(model), {
      onNone: () => Number.POSITIVE_INFINITY,
      onSome: kind => TIMELINES[kind].stampAtMs,
    })
    const worldMs = toMs < stampAtMs ? frameMs * SLOW_MOTION_RATE : frameMs
    const stamped =
      fromMs < stampAtMs && toMs >= stampAtMs
        ? modifyFields(model, {
            shake: shake =>
              modifyFields(shake, {
                trauma: trauma => Math.max(trauma, STAMP_TRAUMA),
              }),
          })
        : model
    const moved = advanceJuice(
      advanceParticles(
        modifyFields(stamped, {
          screenMs: () => toMs,
          frameEvents: () => [],
        }),
        worldMs / MS_PER_SECOND,
        worldMs,
      ),
      frameMs,
      0,
    )
    return playSounds(Array.map(beatSounds(model, fromMs, toMs), uiCue))(moved)
  }

// RETRY

// NOTE: RETRY plays the run's own mode again: a campaign from wave 1, or
// endless from wave 1.
const retry = (model: Model): Model =>
  startWhenAllowed(model, model.mode)

// NOTE: on an end screen Enter retries, E starts endless, and K keeps a won
// run going, once the restart grace is past.
export const endFromKey: {
  (code: string): (model: Model) => Model
  (model: Model, code: string): Model
} = Function.dual(2, (model: Model, code: string): Model => {
  if (Phase.isAnyOf(['Victory'])(model.phase) && isKeepGoingKey(code)) {
    return keepGoingWhenAllowed(model)
  } else if (isStartKey(code)) {
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
  isKeepGoingKey(code) ||
  isMenuKey(code) ||
  Array.contains(AUDIO_KEYS, code)

// NOTE: a press that only skips the beat to the finished card: any key
// before the restart grace, so a key held from the fight never retries or
// leaves, and after it any key with nothing of its own to do. It does
// nothing else, so one press never skips and acts at once.
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

// NOTE: a tap on the game skips the beat, in an online room too, and once
// the beat is over it puts away an unlock card still up. It never starts a
// run (GAME_DESIGN.md, "No tap to start"); the card's buttons do.
export const skipFromPointer = (model: Model): Model =>
  isEndScreen(model.phase)
    ? isBeatOver(model)
      ? dismissUnlock(model)
      : skipBeat(model)
    : model

// AN ONLINE ROOM'S CARD

// NOTE: an online co-op run's end card offers the room's choices once the
// restart grace is past (src/features/menus/menus.ts, endButtonsOf): RUN IT BACK
// toggles this player's READY in the room's lobby, so the same crew plays
// again once everyone is in; LOBBY lets the lobby in (to change the picks
// or kick); LEAVE leaves the room. Until the grace, a press only skips.
const isRunCardOffered = (model: Model): boolean =>
  isCoopOpen(model.coop) && endOffer(model) !== 'Nothing'

const runItBack = makeStep(model =>
  isRunCardOffered(model)
    ? Update.combineSteps([
        toModel(skipBeat(model)),
        CoopBinding.requestToggleReady(),
      ])
    : unchanged,
)

const toRoomLobby = makeStep(model =>
  isRunCardOffered(model) ? toModel(dropRunCard(model)) : unchanged,
)

const leaveRoomFromCard = makeStep(model =>
  isRunCardOffered(model) ? CoopBinding.requestLeave() : unchanged,
)

// NOTE: keys while an online room's run card is up: Enter is RUN IT BACK,
// L is LOBBY, H is LEAVE, M and N toggle the sound (play.ts), and any
// other key skips the beat, so none reaches the hidden lobby.
export const isRunCardKey = (model: Model): boolean =>
  isCoopOpen(model.coop) && isEndScreen(model.phase) && isRunCardHeld(model)

export const runCardFromKey = (code: string) =>
  makeStep(model => {
    if (Array.contains(AUDIO_KEYS, code)) {
      return unchanged
    } else if (!isRunCardOffered(model)) {
      return toModel(skipBeat(model))
    } else if (isStartKey(code)) {
      return runItBack
    } else if (isLobbyKey(code)) {
      return toRoomLobby
    } else if (isMenuKey(code)) {
      return leaveRoomFromCard
    } else {
      return toModel(skipBeat(model))
    }
  })

// SHARE

// NOTE: a tap on SHARE, sent like a run summary, as an anonymous event.
export const SendShareEvent = ApplicationBlock.makeCommand('SendShareEvent', {
  args: { event: ShareEvent },
  messages: [
    EndMessage.CompletedSendShareEvent,
    EndMessage.FailedSendShareEvent,
  ],
  handler: function* () {
    return ({ event }) =>
      sendShareEvent(event).pipe(
        Effect.as(EndMessage.CompletedSendShareEvent()),
        Effect.catch(error =>
          Effect.succeed(
            EndMessage.FailedSendShareEvent({ reason: error.reason }),
          ),
        ),
      )
  },
})

// NOTE: a tap is counted once, as an anonymous event with the path it took,
// only while the player shares play stats (src/platform/analytics.ts, ShareEvent).
const shareEventCommands = (model: Model) =>
  model.shareStats === 'On'
    ? Option.match(model.maybeVisitId, {
        onNone: () => [],
        onSome: visitId => [
          SendShareEvent({
            event: shareEventOf(
              model,
              visitId,
              RUNNING_BUILD,
              runDifficultyOf(model),
              sharePathOf(model),
            ),
          }),
        ],
      })
    : []

// NOTE: the share itself runs in the button's own click (ShareFromClick in
// src/app/mount.ts), so the tap here only skips the beat and counts it.
const shareFromButton: UpdateStep = model =>
  combine(skipBeat(model), [
    stepWhen(
      (skipped: Model) => isEndScreen(skipped.phase),
      skipped => ({ model: skipped, commands: shareEventCommands(skipped) }),
    ),
  ])

// NOTE: a post that went to the clipboard flashes COPIED! on SHARE, timed
// by the end screen's clock. A share sheet shows itself, and a failure
// leaves SHARE as it was, ready for another tap.
const settleShare =
  (outcome: ShareOutcome): UpdateStep =>
  model =>
    outcome === 'Copied'
      ? {
          model: modifyFields(model, {
            maybeShareCopiedAtMs: () => Option.some(model.screenMs),
          }),
        }
      : { model }

// NOTE: the end card's buttons and SHARE (./message.ts).
export const endHandlers = defineHandlers({
  ClickedKeepGoingButton: model =>
    startFromButton(model, keepGoingWhenAllowed(model)),

  ClickedRetryButton: model => startFromButton(model, retry(model)),

  ClickedShareButton: model => combine(model, [unlockAudio, shareFromButton]),

  ClickedRunItBackButton: model =>
    Update.combineSteps(model, [unlockAudio, runItBack]),

  ClickedRoomLobbyButton: model =>
    Update.combineSteps(model, [unlockAudio, toRoomLobby]),

  ClickedLeaveRoomButton: model =>
    Update.combineSteps(model, [unlockAudio, leaveRoomFromCard]),

  SettledShare: (model, { outcome }) => settleShare(outcome)(model),

  CompletedSendShareEvent: model => ({ model }),

  FailedSendShareEvent: model => ({ model }),

  CompletedDetectShareSheet: (model, { shareSheet }) => ({
    model: modifyFields(model, { shareSheet: () => shareSheet }),
  }),
})
