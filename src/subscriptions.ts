import { Array, Clock, Effect, Option, Queue, Schema, Stream } from 'effect'
import { Dom } from 'foldkit'

import { maybeRoomOf } from './coop/roomState'
import { makeSubscriptions } from './definition'
import { isTrackingPointer } from './input'
import { InstallPrompt } from './install'
import { KEY_WATCH_QUIET_MS, isGrabbedKeyUp, isLetterKeyCode } from './keyGrab'
import {
  type BlurredWindow,
  type CancelledPointer,
  type ChangedPageVisibility,
  type FocusedWindow,
  Message,
  type MissedKeyDown,
  type PressedKey,
  type PressedMetaKey,
  type ReleasedEveryTouch,
  type ReleasedPointer,
  type RestoredPageFromCache,
  type TickedFrame,
} from './message'
import type { Model } from './model'
import { StoreEvent } from './playerSync'
import { PlayerStore } from './store'
import { isScreenAnimated } from './update/run'
import {
  RUNNING_BUILD,
  UPDATE_CHECK_INTERVAL,
  isCheckingForUpdates,
  isUpdateCheckWindow,
} from './version'
import { isRoundActive } from './waves'

const isFrameActive = (model: Model): boolean =>
  isRoundActive(model.phase) || isScreenAnimated(model.phase)

const Activity = Schema.Literals(['Idle', 'Active'])
type Activity = typeof Activity.Type

const playingActivity = (model: Model): Activity =>
  isRoundActive(model.phase) ? 'Active' : 'Idle'

const pointerTrackingActivity = (model: Model): Activity =>
  isTrackingPointer(model.input) ? 'Active' : 'Idle'

const isInsideDialog = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('dialog') !== null

const BUTTON_ACTIVATION_KEYS: ReadonlyArray<string> = ['Enter', 'Space']

// NOTE: Enter on a focused link opens it, so it is no game key either.
const isActivatingButton = (
  target: EventTarget | null,
  code: string,
): boolean =>
  Array.contains(BUTTON_ACTIVATION_KEYS, code) &&
  target instanceof Element &&
  target.closest('button, a[href]') !== null

export type KeyDown = Readonly<{
  code: string
  repeat: boolean
  target: EventTarget | null
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}>

// NOTE: Ctrl, Command, and Alt with a key are the browser's and the
// system's shortcuts (Ctrl+D bookmarks, Command+R reloads), never a move.
const isModified = ({ ctrlKey, metaKey, altKey }: KeyDown): boolean =>
  ctrlKey === true || metaKey === true || altKey === true

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable]') !== null

const isLeftToPage = (keyDown: KeyDown): boolean =>
  isModified(keyDown) ||
  isInsideDialog(keyDown.target) ||
  isEditable(keyDown.target) ||
  isActivatingButton(keyDown.target, keyDown.code)

const isMetaKeyCode = (code: string): boolean =>
  code === 'MetaLeft' || code === 'MetaRight'

type KeyDownMessage = PressedKey | PressedMetaKey

export const maybeKeyDownMessage = (
  keyDown: KeyDown,
): Option.Option<KeyDownMessage> => {
  if (isMetaKeyCode(keyDown.code)) {
    return keyDown.repeat
      ? Option.none()
      : Option.some(Message.PressedMetaKey())
  }
  return keyDown.repeat || isLeftToPage(keyDown)
    ? Option.none()
    : Option.some(Message.PressedKey({ code: keyDown.code }))
}

const BROWSER_DEFAULT_KEYS: ReadonlyArray<string> = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Enter',
  'Slash',
  'Quote',
  'Period',
  'Comma',
]

// NOTE: a game key never does the browser's own thing as well: arrows and
// Space scroll, and Firefox opens its quick find on / and '. Held keys
// repeat, so a repeat is kept from the browser too.
export const isKeptFromBrowser = (keyDown: KeyDown): boolean =>
  (isLetterKeyCode(keyDown.code) ||
    Array.contains(BROWSER_DEFAULT_KEYS, keyDown.code)) &&
  !isLeftToPage(keyDown)

const keyDownMessage = (
  event: KeyboardEvent,
): Option.Option<KeyDownMessage> => {
  if (isKeptFromBrowser(event)) {
    event.preventDefault()
  }
  return maybeKeyDownMessage(event)
}

export const maybeWindowBlurMessage = ({
  target,
}: Readonly<{ target: EventTarget | null }>): Option.Option<BlurredWindow> =>
  target instanceof Window
    ? Option.some(Message.BlurredWindow())
    : Option.none()

export const maybeWindowFocusMessage = ({
  target,
}: Readonly<{ target: EventTarget | null }>): Option.Option<FocusedWindow> =>
  target === window ? Option.some(Message.FocusedWindow()) : Option.none()

export const maybePageShowMessage = ({
  persisted,
}: Readonly<{ persisted: boolean }>): Option.Option<RestoredPageFromCache> =>
  persisted ? Option.some(Message.RestoredPageFromCache()) : Option.none()

export const pageVisibilityMessage = (
  visibilityState: DocumentVisibilityState,
): ChangedPageVisibility =>
  Message.ChangedPageVisibility({
    visibility: visibilityState === 'hidden' ? 'Hidden' : 'Visible',
  })

export const updateCheckActivity = (model: Model): Activity =>
  isCheckingForUpdates(RUNNING_BUILD) && isUpdateCheckWindow(model.phase)
    ? 'Active'
    : 'Idle'

const updateCheckMessages = Stream.map(Stream.tick(UPDATE_CHECK_INTERVAL), () =>
  Message.TickedUpdateCheck(),
)

const keyboardMessages = () =>
  Stream.merge(
    Dom.streamFromEventFilterMap({
      target: document,
      type: 'keydown',
      filterMapEvent: keyDownMessage,
    }),
    Dom.streamFromEvent({
      target: document,
      type: 'keyup',
      mapEvent: event => Message.ReleasedKey({ code: event.code }),
    }),
  )

// NOTE: the watch for a browser extension that grabs keys (src/keyGrab.ts).
// It listens on the window in the capture phase, ahead of anything in the
// page, so only an extension, which listens there first, can hide a keydown
// from it. Everything it sees is forgotten when the page loses focus.
const keyWatchMessages = Stream.suspend(() => {
  const seenKeys = new Set<string>()
  let quietUntilMs = performance.now() + KEY_WATCH_QUIET_MS
  const forget = (): Option.Option<never> => {
    seenKeys.clear()
    quietUntilMs = performance.now() + KEY_WATCH_QUIET_MS
    return Option.none()
  }
  const capture = { capture: true }
  return Stream.mergeAll<MissedKeyDown, never, never>(
    [
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'keydown',
        options: capture,
        filterMapEvent: event => {
          seenKeys.add(event.code)
          return Option.none()
        },
      }),
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'keyup',
        options: capture,
        filterMapEvent: event => {
          const wasSeen = seenKeys.delete(event.code)
          return isGrabbedKeyUp({
            code: event.code,
            wasSeen,
            isModified: event.ctrlKey || event.metaKey || event.altKey,
            hasFocus: document.hasFocus(),
            nowMs: performance.now(),
            quietUntilMs,
          })
            ? Option.some(Message.MissedKeyDown({ code: event.code }))
            : Option.none()
        },
      }),
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'blur',
        filterMapEvent: forget,
      }),
      Dom.streamFromEventFilterMap({
        target: window,
        type: 'focus',
        filterMapEvent: forget,
      }),
      Dom.streamFromEventFilterMap({
        target: document,
        type: 'visibilitychange',
        filterMapEvent: forget,
      }),
    ],
    { concurrency: 'unbounded' },
  )
})

const pointerMoveMessages = () =>
  Dom.streamFromEventFilterMap({
    target: document,
    type: 'pointermove',
    filterMapEvent: event =>
      event.pointerType === 'mouse'
        ? Option.none()
        : Option.some(
            Message.MovedPointer({
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          ),
  })

const maybeEveryTouchEndedMessage = (
  event: TouchEvent,
): Option.Option<ReleasedEveryTouch> =>
  event.touches.length === 0
    ? Option.some(Message.ReleasedEveryTouch())
    : Option.none()

// NOTE: releases listen all the time, not only while a pointer is tracked.
// A quick tap can lift its finger before a tracking-only listener is
// attached, and a missed release leaves the stick held forever. Releasing a
// pointer that is not tracked changes nothing.
const pointerReleaseMessages = () =>
  Stream.mergeAll<
    ReleasedPointer | CancelledPointer | ReleasedEveryTouch,
    never,
    never
  >(
    [
      Dom.streamFromEvent({
        target: document,
        type: 'pointerup',
        mapEvent: event =>
          Message.ReleasedPointer({ pointerId: event.pointerId }),
      }),
      Dom.streamFromEvent({
        target: document,
        type: 'pointercancel',
        mapEvent: event =>
          Message.CancelledPointer({ pointerId: event.pointerId }),
      }),
      Dom.streamFromEventFilterMap({
        target: document,
        type: 'touchend',
        filterMapEvent: maybeEveryTouchEndedMessage,
      }),
      Dom.streamFromEventFilterMap({
        target: document,
        type: 'touchcancel',
        filterMapEvent: maybeEveryTouchEndedMessage,
      }),
    ],
    { concurrency: 'unbounded' },
  )

const mouseMessages = () =>
  Dom.streamFromEventFilterMap({
    target: document,
    type: 'pointermove',
    filterMapEvent: event =>
      event.pointerType === 'mouse'
        ? Option.some(
            Message.MovedMouse({
              clientX: event.clientX,
              clientY: event.clientY,
            }),
          )
        : Option.none(),
  })

// NOTE: what the store hears from sync: a save another device or the
// server changed, the status line for SETTINGS, and how far the player
// scope has loaded.
const syncMessageOf = (event: StoreEvent) =>
  StoreEvent.match(event, {
    SyncedSave: ({ save }) => Message.UpdatedSyncedSave({ save }),
    SyncStatus: ({ state }) => Message.UpdatedSyncStatus({ state }),
    ScopeStatus: ({ status }) => Message.UpdatedPlayerScopeStatus({ status }),
  })

// NOTE: requestAnimationFrame's ticks with the time since the last one,
// while the round or an end screen is moving. A hidden tab gets no frames,
// so the first delta after it comes back can be seconds long: the update
// clamps it (clampFrameDelta in src/frame.ts).
const animationFrames = Stream.callback<TickedFrame>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = { frameId: 0, lastTime: performance.now() }
      const tick = (now: number) => {
        const deltaTime = now - state.lastTime
        state.lastTime = now
        Queue.offerUnsafe(queue, Message.TickedFrame({ deltaTime }))
        state.frameId = requestAnimationFrame(tick)
      }
      state.frameId = requestAnimationFrame(tick)
      return state
    }),
    state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
  ).pipe(Effect.flatMap(() => Effect.never)),
)

const FrameActivity = Schema.Struct({ isActive: Schema.Boolean })

// NOTE: the co-op room's frame clock, while its game is playing: the time
// of each animation frame. The root ticks the room with it through the
// co-op Binding (src/update/coop.ts).
const roomFrameTimes: Stream.Stream<number> = Stream.callback<number>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = { frameId: 0 }
      const tick = (): void => {
        Queue.offerUnsafe(queue, 0)
        state.frameId = requestAnimationFrame(tick)
      }
      state.frameId = requestAnimationFrame(tick)
      return state
    }),
    state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
  ).pipe(Effect.flatMap(() => Effect.never)),
).pipe(Stream.mapEffect(() => Clock.currentTimeMillis))

const isRoomPlaying = (model: Model): boolean =>
  Option.exists(
    maybeRoomOf(model.coop),
    room => room.session.phase._tag === 'Playing',
  )

export const subscriptions = makeSubscriptions(entry => ({
  playerSync: entry('PlayerSync', {
    messages: [
      Message.UpdatedSyncedSave,
      Message.UpdatedSyncStatus,
      Message.UpdatedPlayerScopeStatus,
    ],
    handler: function* () {
      const store = yield* PlayerStore
      return () => Stream.map(store.events, syncMessageOf)
    },
  }),

  // NOTE: what the browser offers to install, held by the InstallPrompt
  // service from the moment the runtime starts.
  installOffers: entry('InstallOffers', {
    messages: [Message.ChangedInstallOffer],
    handler: function* () {
      const installPrompt = yield* InstallPrompt
      return () =>
        Stream.map(installPrompt.offers, installOffer =>
          Message.ChangedInstallOffer({ installOffer }),
        )
    },
  }),

  frame: entry('Frame', FrameActivity.fields, {
    messages: [Message.TickedFrame],
    modelToDependencies: model => ({ isActive: isFrameActive(model) }),
    handler: function* () {
      return ({ isActive }) =>
        Stream.when(
          animationFrames,
          Effect.sync(() => isActive),
        )
    },
  }),

  roomFrame: entry(
    'RoomFrame',
    { isPlaying: Schema.Boolean },
    {
      messages: [Message.TickedRoomFrame],
      modelToDependencies: model => ({ isPlaying: isRoomPlaying(model) }),
      handler: function* () {
        return ({ isPlaying }) =>
          isPlaying
            ? Stream.map(roomFrameTimes, nowMs =>
                Message.TickedRoomFrame({ nowMs }),
              )
            : Stream.empty
      },
    },
  ),

  keyboard: entry('Keyboard', {
    messages: [Message.PressedKey, Message.PressedMetaKey, Message.ReleasedKey],
    handler: function* () {
      return keyboardMessages
    },
  }),

  keyWatch: entry('KeyWatch', {
    messages: [Message.MissedKeyDown],
    handler: function* () {
      return () => keyWatchMessages
    },
  }),

  windowBlur: entry('WindowBlur', {
    messages: [Message.BlurredWindow],
    handler: function* () {
      return () =>
        Dom.streamFromEventFilterMap({
          target: window,
          type: 'blur',
          filterMapEvent: maybeWindowBlurMessage,
        })
    },
  }),

  pageVisibility: entry('PageVisibility', {
    messages: [Message.ChangedPageVisibility],
    handler: function* () {
      return () =>
        Dom.streamFromEvent({
          target: document,
          type: 'visibilitychange',
          mapEvent: () => pageVisibilityMessage(document.visibilityState),
        })
    },
  }),

  windowFocus: entry('WindowFocus', {
    messages: [Message.FocusedWindow],
    handler: function* () {
      return () =>
        Dom.streamFromEventFilterMap({
          target: window,
          type: 'focus',
          filterMapEvent: maybeWindowFocusMessage,
        })
    },
  }),

  pageRestores: entry('PageRestores', {
    messages: [Message.RestoredPageFromCache],
    handler: function* () {
      return () =>
        Dom.streamFromEventFilterMap({
          target: window,
          type: 'pageshow',
          filterMapEvent: maybePageShowMessage,
        })
    },
  }),

  updateCheck: entry(
    'UpdateCheck',
    { activity: Activity },
    {
      messages: [Message.TickedUpdateCheck],
      modelToDependencies: model => ({
        activity: updateCheckActivity(model),
      }),
      handler: function* () {
        return ({ activity }) =>
          Stream.when(
            updateCheckMessages,
            Effect.sync(() => activity === 'Active'),
          )
      },
    },
  ),

  mouseAim: entry(
    'MouseAim',
    { activity: Activity },
    {
      messages: [Message.MovedMouse],
      modelToDependencies: model => ({ activity: playingActivity(model) }),
      handler: function* () {
        return ({ activity }) =>
          Stream.when(
            mouseMessages(),
            Effect.sync(() => activity === 'Active'),
          )
      },
    },
  ),

  pointerReleases: entry('PointerReleases', {
    messages: [
      Message.ReleasedPointer,
      Message.CancelledPointer,
      Message.ReleasedEveryTouch,
    ],
    handler: function* () {
      return pointerReleaseMessages
    },
  }),

  fullscreenChanges: entry('FullscreenChanges', {
    messages: [Message.ChangedFullscreen],
    handler: function* () {
      return () =>
        Dom.streamFromEvent({
          target: document,
          type: 'fullscreenchange',
          mapEvent: () =>
            Message.ChangedFullscreen({
              fullscreen: document.fullscreenElement === null ? 'Off' : 'On',
            }),
        })
    },
  }),

  trackedPointers: entry(
    'TrackedPointers',
    { activity: Activity },
    {
      messages: [Message.MovedPointer],
      modelToDependencies: model => ({
        activity: pointerTrackingActivity(model),
      }),
      handler: function* () {
        return ({ activity }) =>
          Stream.when(
            pointerMoveMessages(),
            Effect.sync(() => activity === 'Active'),
          )
      },
    },
  ),
}))
