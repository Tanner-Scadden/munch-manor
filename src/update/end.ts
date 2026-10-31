import { Array, Data, Effect, Option, Schema } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { ShareEvent } from '../analytics'
import { sendShareEvent } from '../analyticsBeacon'
import { shareEventOf } from '../analyticsRun'
import { isOpen as isCoopOpen } from '../coop/update'
import { makeCommand } from '../definition'
import {
  TIMELINES,
  beatSounds,
  dropRunCard,
  endKindOf,
  isBeatOver,
  isRunCardHeld,
  sharePathOf,
  sharedRunOf,
  skipBeat,
} from '../endBeat'
import { END_SHARE_BUTTON_ID, endOffer, isEndScreen } from '../home'
import {
  isCharacterKey,
  isEndlessKey,
  isKeepGoingKey,
  isMenuKey,
  isStartKey,
} from '../input'
import { advanceJuice } from '../juice'
import { Message } from '../message'
import { type Model, Phase, RunMode, type ShareSheetOutcome } from '../model'
import { runDifficultyOf } from '../onlineRun'
import { advanceParticles } from '../particles'
import { shareSheetData, shareUrl } from '../share'
import { stepWhen } from '../stepWhen'
import { RUNNING_BUILD } from '../version'
import { keepGoingWhenAllowed, startWhenAllowed } from './run'
import { playSounds, uiCue } from './sound'
import { type UpdateStep, combine } from './step'

// The end of a run in update (the beat itself is src/endBeat.ts): its
// frame, its keys and taps, RETRY, and sharing the run to X.

const MS_PER_SECOND = 1000

// NOTE: until the stamp lands the gore of the last bite flies in slow
// motion, then at full speed, so it settles while the card tallies.
const SLOW_MOTION_RATE = 0.3
const STAMP_TRAUMA = 0.7
const X_KEY = 'KeyX'

const isShareKey = (code: string): boolean => code === X_KEY

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
export const retry = (model: Model): Model =>
  startWhenAllowed(model, model.mode)

// NOTE: on an end screen Enter retries, E starts endless, and K keeps a won
// run going, once the restart grace is past.
export const endFromKey = (model: Model, code: string): Model => {
  if (Phase.isAnyOf(['Victory'])(model.phase) && isKeepGoingKey(code)) {
    return keepGoingWhenAllowed(model)
  } else if (isStartKey(code)) {
    return retry(model)
  } else if (isEndlessKey(code)) {
    return startWhenAllowed(model, RunMode.Endless())
  } else {
    return model
  }
}

const AUDIO_KEYS: ReadonlyArray<string> = ['KeyM', 'KeyN']

const isEndActionKey = (code: string): boolean =>
  isCharacterKey(code) ||
  isStartKey(code) ||
  isEndlessKey(code) ||
  isKeepGoingKey(code) ||
  isMenuKey(code) ||
  isShareKey(code) ||
  Array.contains(AUDIO_KEYS, code)

// NOTE: a press that only skips the beat to the finished card: any key
// before the restart grace, so a key held from the fight never retries or
// leaves, and after it any key with nothing of its own to do. It does
// nothing else, so one press never skips and acts at once.
export const isBeatSkipKey = (model: Model, code: string): boolean =>
  isEndScreen(model.phase) &&
  !isBeatOver(model) &&
  (endOffer(model) === 'Nothing' || !isEndActionKey(code))

// NOTE: a tap on the game skips the beat; in an online room, it then lets
// the lobby in. It never starts a run (GAME_DESIGN.md, "No tap to start").
export const skipFromPointer = (model: Model): Model => {
  if (!isEndScreen(model.phase)) {
    return model
  } else if (isCoopOpen(model.coop)) {
    return dropRunCard(model)
  } else {
    return skipBeat(model)
  }
}

// NOTE: keys while an online room's run card is up: X shares, M and N
// toggle the sound, and any other key skips or lets the lobby in, so they
// never reach the hidden lobby (Enter would ready up behind the card).
export const isRunCardKey = (model: Model): boolean =>
  isCoopOpen(model.coop) && isEndScreen(model.phase) && isRunCardHeld(model)

export const runCardFromKey = (model: Model, code: string): Model =>
  isShareKey(code) || Array.contains(AUDIO_KEYS, code)
    ? model
    : dropRunCard(model)

// SHARE

// NOTE: on a keyboard (and anywhere without a share sheet) SHARE is X's
// intent link (src/menus.ts), so the browser opens it on the click itself.
// X clicks that same link from the key's own Command, inside the key
// press's activation, and the click sends ClickedShareButton like a tap.
export const ClickShareLink = makeCommand('ClickShareLink', {
  messages: [Message.CompletedClickShareLink],
  handler: function* () {
    return () =>
      Dom.clickElement(`#${END_SHARE_BUTTON_ID}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedClickShareLink()),
      )
  },
})

class ShareSheetClosed extends Data.TaggedError('ShareSheetClosed')<{
  readonly outcome: 'Cancelled' | 'Refused'
}> {}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

// NOTE: on a touch screen with a share sheet, SHARE opens it with the post's
// words and the game, so the player picks X and X's own composer opens
// filled in. It runs right after the tap, still inside the tap's user
// activation. A player who closes the sheet is Cancelled; a browser that
// refuses it (NotAllowedError) or fails is Refused, and the link takes over.
export const OpenShareSheet = makeCommand('OpenShareSheet', {
  args: { text: Schema.String, url: Schema.String },
  messages: [Message.SettledShareSheet],
  handler: function* () {
    return ({ text, url }) =>
      Effect.tryPromise({
        try: () => navigator.share({ text, url }),
        catch: error =>
          new ShareSheetClosed({
            outcome: isAbort(error) ? 'Cancelled' : 'Refused',
          }),
      }).pipe(
        Effect.as(Message.SettledShareSheet({ outcome: 'Shared' })),
        Effect.catch(({ outcome }) =>
          Effect.succeed(Message.SettledShareSheet({ outcome })),
        ),
      )
  },
})

// NOTE: the fallback when the share sheet is refused: X's intent link in a
// new tab. It may come too late for a strict popup blocker, but the next tap
// on SHARE is the link itself (shareSheet is Unavailable from then on).
export const OpenShareLink = makeCommand('OpenShareLink', {
  args: { url: Schema.String },
  messages: [Message.CompletedOpenShareLink],
  handler: function* () {
    return ({ url }) =>
      Effect.sync(() => window.open(url, '_blank', 'noopener,noreferrer')).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedOpenShareLink()),
      )
  },
})

// NOTE: a tap on SHARE, sent like a run summary, as an anonymous event.
export const SendShareEvent = makeCommand('SendShareEvent', {
  args: { event: ShareEvent },
  messages: [Message.CompletedSendShareEvent, Message.FailedSendShareEvent],
  handler: function* () {
    return ({ event }) =>
      sendShareEvent(event).pipe(
        Effect.as(Message.CompletedSendShareEvent()),
        Effect.catch(error =>
          Effect.succeed(
            Message.FailedSendShareEvent({ reason: error.reason }),
          ),
        ),
      )
  },
})

// NOTE: a tap is counted once, as an anonymous event with the path it took,
// only while the player shares play stats (src/analytics.ts, ShareEvent).
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

// NOTE: the share sheet's Command on its path; the link opens by itself.
const sheetCommands = (model: Model) =>
  sharePathOf(model) === 'Sheet'
    ? [
        OpenShareSheet(
          shareSheetData(sharedRunOf(model, runDifficultyOf(model))),
        ),
      ]
    : []

const countShare: UpdateStep = stepWhen(
  (model: Model) => isEndScreen(model.phase),
  model => ({
    model,
    commands: [...sheetCommands(model), ...shareEventCommands(model)],
  }),
)

export const shareFromKey = (code: string): UpdateStep =>
  stepWhen(
    (model: Model) => isShareKey(code) && isEndScreen(model.phase),
    model => ({ model, commands: [ClickShareLink()] }),
  )

export const shareFromButton: UpdateStep = model =>
  combine(skipBeat(model), [countShare])

// NOTE: a refused share sheet falls back to the intent link now and on
// every later tap. Shared and Cancelled need nothing more.
export const settleShareSheet =
  (outcome: ShareSheetOutcome): UpdateStep =>
  model =>
    outcome === 'Refused'
      ? {
          model: modifyFields(model, { shareSheet: () => 'Unavailable' }),
          commands: [
            OpenShareLink({
              url: shareUrl(sharedRunOf(model, runDifficultyOf(model))),
            }),
          ],
        }
      : { model }
