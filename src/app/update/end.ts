import { Array, Effect, Function, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { runDifficultyOf } from '../../domain/onlineRun'
import { isEndScreen } from '../../domain/run'
import { isOpen as isCoopOpen } from '../../features/coop/update'
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
} from '../../features/end/endBeat'
import { endOffer } from '../../features/end/endOffer'
import type { ShareOutcome } from '../../features/end/share'
import {
  isCharacterKey,
  isEndlessKey,
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
import { stepWhen } from '../../shared/stepWhen'
import { RunMode } from '../../world/schema/worldSchema'
import type { Model } from '../model'
import { leaveCoopRoom, toggleCoopReady } from './coop'
import { startFromButton, startWhenAllowed } from './run'
import { playSounds, uiCue, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  toModel,
} from './step'

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

// RETRY

// NOTE: RETRY plays the run's own mode again: a campaign from wave 1, or
// endless from wave 1.
const retry = (model: Model): Model => startWhenAllowed(model, model.mode)

// NOTE: on an end screen Enter retries and E starts endless, once the
// restart grace is past.
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
// restart grace is past (src/screens/game/menus.ts, endButtonsOf): PLAY AGAIN
// toggles this player's READY in the room's lobby, so the same crew plays
// again once everyone is in; LOBBY lets the lobby in (to change the picks
// or kick); LEAVE leaves the room. Until the grace, a press only skips.
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

// NOTE: keys while an online room's run card is up: Enter is PLAY AGAIN,
// L is LOBBY, H is LEAVE, M and N toggle the sound (play.ts), and any
// other key skips the beat, so none reaches the hidden lobby.
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

// SHARE

// NOTE: a tap on SHARE, sent like a run summary, as an anonymous event.
// Nothing on screen waits on it, so a failure is logged and nothing is
// reported.
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

// NOTE: a tap is counted once, as an anonymous event with the path it took,
// only while the player shares play stats (src/platform/analytics.ts, ShareEvent).
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

// NOTE: the share itself runs in the button's own click (ShareFromClick in
// src/app/mount.ts), so the tap here only skips the beat and counts it.
const shareFromButton: UpdateStep = combine([
  modelStep(skipBeat),
  stepWhen((skipped: Model) => isEndScreen(skipped.phase), sendShare),
])

// NOTE: a post that went to the clipboard flashes COPIED! on SHARE, timed
// by the end screen's clock. A share sheet shows itself, and a failure
// leaves SHARE as it was, ready for another tap.
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

// NOTE: the end card's buttons and SHARE (./message.ts).
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
