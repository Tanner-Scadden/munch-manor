import { Array, Clock, Effect, Option, Queue, Schema, Stream } from 'effect'

import { Subscription } from '@effect/ui'

import { isRoomFrameDue } from '../domain/onlineRun'
import type { CoopNet } from '../features/coop/net'
import { coopSubscriptions } from '../features/coop/subscriptions'
import {
  MENU_REPEAT_DELAY_MS,
  MENU_REPEAT_MS,
  type PadDirection,
  isSamePoll,
  padDirection,
  pickPad,
} from '../input/gamepad'
import { isTrackingPointer } from '../input/input'
import type { Gamepad } from '../input/inputSchema'
import {
  KEY_WATCH_QUIET_MS,
  isGrabbedKeyUp,
  isLetterKeyCode,
} from '../input/keyGrab'
import type {
  DisconnectedGamepad,
  PolledGamepad,
  RepeatedPadDirection,
} from '../input/message'
import { InstallPrompt } from '../platform/install'
import { StoreEvent } from '../platform/playerSync'
import { PlayerStore } from '../platform/store'
import { todays } from '../platform/today'
import {
  RUNNING_BUILD,
  UPDATE_CHECK_INTERVAL,
  isCheckingForUpdates,
  isUpdateCheckWindow,
} from '../platform/version'
import { DARE_LIST_BUTTON_CLASS } from '../screens/game/dareListButton'
import { isRunUnderway } from '../world/run/arrival'
import { isRoundActive } from '../world/waves/waves'
import {
  type FramePace,
  OPEN_GATE,
  framePaceOf,
  gateFor,
  gateFrame,
} from './frameGate'
import {
  type BlurredWindow,
  type CancelledPointer,
  type ChangedPageVisibility,
  type ChangedTouches,
  type FocusedWindow,
  Message,
  type MissedKeyDown,
  type PressedKey,
  type PressedMetaKey,
  type ReleasedPointer,
  type RestoredPageFromCache,
  type TickedFrame,
} from './message'
import type { Model } from './model'
import { isPadMenuUp } from './update/padMenu'
import { isScreenAnimated } from './update/run'

const isFrameActive = (model: Model): boolean =>
  isRunUnderway(model.phase) || isScreenAnimated(model.phase)

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

// NOTE: Tab opens and puts away the dare card while the HUD's dare list
// is there to open (src/screens/game/dareListButton.ts), so then it never
// moves the page's focus as well. Anywhere else Tab is the browser's.
const isDareListTab = (event: KeyboardEvent): boolean =>
  event.code === 'Tab' &&
  !isLeftToPage(event) &&
  document.querySelector(`.${DARE_LIST_BUTTON_CLASS}`) !== null

const keyDownMessage = (
  event: KeyboardEvent,
): Option.Option<KeyDownMessage> => {
  if (isKeptFromBrowser(event) || isDareListTab(event)) {
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

// NOTE: a stream of one event on the document or the window, each event
// read in its own listener, so a handler that calls `preventDefault` does
// so before the browser acts on the event.
const listenerStream = <Msg>(
  attach: (emit: (maybeMessage: Option.Option<Msg>) => void) => () => void,
): Stream.Stream<Msg> =>
  Stream.callback<Msg>(queue =>
    Effect.acquireRelease(
      Effect.sync(() =>
        attach(maybeMessage => {
          if (Option.isSome(maybeMessage)) {
            Queue.offerUnsafe(queue, maybeMessage.value)
          }
        }),
      ),
      detach => Effect.sync(detach),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

const documentEvents = <K extends keyof DocumentEventMap, Msg>(
  type: K,
  toMessage: (event: DocumentEventMap[K]) => Option.Option<Msg>,
): Stream.Stream<Msg> =>
  listenerStream<Msg>(emit => {
    const listener = (event: DocumentEventMap[K]): void =>
      emit(toMessage(event))
    document.addEventListener(type, listener)
    return () => document.removeEventListener(type, listener)
  })

const windowEvents = <K extends keyof WindowEventMap, Msg>(
  type: K,
  toMessage: (event: WindowEventMap[K]) => Option.Option<Msg>,
  options?: AddEventListenerOptions,
): Stream.Stream<Msg> =>
  listenerStream<Msg>(emit => {
    const listener = (event: WindowEventMap[K]): void => emit(toMessage(event))
    window.addEventListener(type, listener, options)
    return () => window.removeEventListener(type, listener, options)
  })

const updateCheckMessages = Stream.map(Stream.tick(UPDATE_CHECK_INTERVAL), () =>
  Message.TickedUpdateCheck(),
)

const keyboardMessages = Stream.merge(
  documentEvents('keydown', keyDownMessage),
  documentEvents('keyup', event =>
    Option.some(Message.ReleasedKey({ code: event.code })),
  ),
)

// NOTE: the watch for a browser extension that grabs keys (src/input/keyGrab.ts).
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
      windowEvents(
        'keydown',
        event => {
          seenKeys.add(event.code)
          return Option.none()
        },
        capture,
      ),
      windowEvents(
        'keyup',
        event => {
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
        capture,
      ),
      windowEvents('blur', forget),
      windowEvents('focus', forget),
      documentEvents('visibilitychange', forget),
    ],
    { concurrency: 'unbounded' },
  )
})

const pointerMoveMessages = documentEvents('pointermove', event =>
  event.pointerType === 'mouse'
    ? Option.none()
    : Option.some(
        Message.MovedPointer({
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      ),
)

// NOTE: the fingers on the glass, so a stick held by a finger whose lift
// never came (iOS Safari loses one now and then) lets go at the next touch.
const touchesMessage = (event: TouchEvent): ChangedTouches =>
  Message.ChangedTouches({
    points: Array.map(Array.fromIterable(event.touches), touch => ({
      clientX: touch.clientX,
      clientY: touch.clientY,
    })),
  })

// NOTE: releases listen all the time, not only while a pointer is tracked.
// A quick tap can lift its finger before a tracking-only listener is
// attached, and a missed release leaves the stick held forever. Releasing a
// pointer that is not tracked changes nothing.
const someTouches = (event: TouchEvent): Option.Option<ChangedTouches> =>
  Option.some(touchesMessage(event))

const pointerReleaseMessages = Stream.mergeAll<
  ReleasedPointer | CancelledPointer | ChangedTouches,
  never,
  never
>(
  [
    documentEvents('pointerup', event =>
      Option.some(Message.ReleasedPointer({ pointerId: event.pointerId })),
    ),
    documentEvents('pointercancel', event =>
      Option.some(Message.CancelledPointer({ pointerId: event.pointerId })),
    ),
    documentEvents('touchstart', someTouches),
    documentEvents('touchend', someTouches),
    documentEvents('touchcancel', someTouches),
  ],
  { concurrency: 'unbounded' },
)

const mouseMessages = documentEvents('pointermove', event =>
  event.pointerType === 'mouse'
    ? Option.some(
        Message.MovedMouse({
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      )
    : Option.none(),
)

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
// while the round or an end screen is moving, through the frame gate
// (src/app/frameGate.ts): a fast screen's frames that owe no sim tick are
// held and sent with the next, so the game draws at most about 60 a
// second, and on the title and its menus at most 30. A hidden tab gets no
// frames, so the first delta after it comes back can be seconds long: the
// update clamps it (clampFrameDelta in src/app/frame.ts).
const animationFrames = (pace: FramePace) =>
  Stream.callback<TickedFrame>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const state = {
          frameId: 0,
          lastTime: performance.now(),
          gate: OPEN_GATE,
        }
        const gate = gateFor(pace)
        const tick = (now: number) => {
          const gated = gate(state.gate, now - state.lastTime)
          state.lastTime = now
          state.gate = gated.gate
          Option.match(gated.sendMs, {
            onNone: () => {},
            onSome: deltaTime =>
              Queue.offerUnsafe(queue, Message.TickedFrame({ deltaTime })),
          })
          state.frameId = requestAnimationFrame(tick)
        }
        state.frameId = requestAnimationFrame(tick)
        return state
      }),
      state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

type GamepadMessage = PolledGamepad | DisconnectedGamepad

const hasGamepads = (): boolean => typeof navigator.getGamepads === 'function'

// NOTE: the controller, polled once an animation frame while one is
// plugged in (a pad that was in before the page loaded shows itself on its
// first press, with `gamepadconnected`). Only a change is sent, the axes
// already quantized (src/input/gamepad.ts), so a resting pad sends nothing
// and `update` never reads the pad itself. When the pad goes, the root
// hears DisconnectedGamepad and the loop stops until the next one comes.
const gamepadMessages = Stream.callback<GamepadMessage>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state: {
        frameId: number
        maybeLast: Option.Option<Gamepad>
      } = { frameId: 0, maybeLast: Option.none() }
      const poll = (): void => {
        const maybePad = pickPad(
          navigator.getGamepads(),
          Option.map(state.maybeLast, pad => pad.index),
        )
        Option.match(maybePad, {
          onNone: () => {
            Option.map(state.maybeLast, last =>
              Queue.offerUnsafe(
                queue,
                Message.DisconnectedGamepad({ index: last.index }),
              ),
            )
            state.maybeLast = Option.none()
            state.frameId = 0
          },
          onSome: pad => {
            const isChanged = !Option.exists(state.maybeLast, last =>
              isSamePoll(last, pad),
            )
            if (isChanged) {
              Queue.offerUnsafe(queue, Message.PolledGamepad(pad))
            }
            state.maybeLast = Option.some(pad)
            state.frameId = requestAnimationFrame(poll)
          },
        })
      }
      const start = (): void => {
        if (state.frameId === 0) {
          state.frameId = requestAnimationFrame(poll)
        }
      }
      window.addEventListener('gamepadconnected', start)
      start()
      return { state, start }
    }),
    ({ state, start }) =>
      Effect.sync(() => {
        window.removeEventListener('gamepadconnected', start)
        cancelAnimationFrame(state.frameId)
      }),
  ).pipe(Effect.flatMap(() => Effect.never)),
)

// NOTE: a direction held on the pad while a menu is up steps again, as a
// held arrow key repeats: first after MENU_REPEAT_DELAY_MS, then every
// MENU_REPEAT_MS. The first step is the poll's own (newDirection in
// src/input/gamepad.ts); this sends only the repeats, so a pad resting or
// pointing nowhere sends nothing.
const padRepeats = Stream.callback<RepeatedPadDirection>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state: {
        frameId: number
        maybeHeld: Option.Option<PadDirection>
        nextAtMs: number
      } = { frameId: 0, maybeHeld: Option.none(), nextAtMs: 0 }
      const poll = (nowMs: number): void => {
        const maybeDirection = Option.flatMap(
          pickPad(navigator.getGamepads(), Option.none()),
          padDirection,
        )
        const isSame =
          Option.isSome(maybeDirection) &&
          Option.contains(state.maybeHeld, maybeDirection.value)
        if (!isSame) {
          state.maybeHeld = maybeDirection
          state.nextAtMs = nowMs + MENU_REPEAT_DELAY_MS
        } else if (nowMs >= state.nextAtMs) {
          state.nextAtMs = nowMs + MENU_REPEAT_MS
          Option.map(maybeDirection, direction =>
            Queue.offerUnsafe(
              queue,
              Message.RepeatedPadDirection({ direction }),
            ),
          )
        }
        state.frameId = requestAnimationFrame(poll)
      }
      state.frameId = requestAnimationFrame(poll)
      return state
    }),
    state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
  ).pipe(Effect.flatMap(() => Effect.never)),
)

// NOTE: the co-op room's frame clock, while its game is playing: the time
// of each animation frame. The root ticks the room with it through the
// co-op Binding (src/app/update/coop.ts).
const roomFrameTimes: Stream.Stream<number> = Stream.callback<number>(queue =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const state = { frameId: 0, lastTime: performance.now(), gate: OPEN_GATE }
      const tick = (now: number): void => {
        const gated = gateFrame(state.gate, now - state.lastTime)
        state.lastTime = now
        state.gate = gated.gate
        if (Option.isSome(gated.sendMs)) {
          Queue.offerUnsafe(queue, 0)
        }
        state.frameId = requestAnimationFrame(tick)
      }
      state.frameId = requestAnimationFrame(tick)
      return state
    }),
    state => Effect.sync(() => cancelAnimationFrame(state.frameId)),
  ).pipe(Effect.flatMap(() => Effect.never)),
).pipe(Stream.mapEffect(() => Clock.currentTimeMillis))

// THE SUBSCRIPTIONS

// NOTE: what the store hears from sync, today's day, and what the browser
// offers to install, each for the life of the page.
const playerSync = Subscription.make(
  'PlayerSync',
  Stream.unwrap(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return Stream.map(store.events, syncMessageOf)
    }),
  ),
)

// NOTE: today's day in UTC, from start, then each new day.
const today = Subscription.make(
  'Today',
  Stream.map(todays, day => Message.ChangedToday({ day })),
)

// NOTE: what the browser offers to install, held by the InstallPrompt
// service from the moment the runtime starts.
const installOffers = Subscription.make(
  'InstallOffers',
  Stream.unwrap(
    Effect.gen(function* () {
      const installPrompt = yield* InstallPrompt
      return Stream.map(installPrompt.offers, installOffer =>
        Message.ChangedInstallOffer({ installOffer }),
      )
    }),
  ),
)

// NOTE: one Subscription per pace, keyed by it, so a change of pace closes
// the old frame loop before the new one starts.
const frames: {
  readonly [Pace in FramePace]: Subscription.Subscription<TickedFrame>
} = {
  Play: Subscription.make('Frame', 'Play', animationFrames),
  Menu: Subscription.make('Frame', 'Menu', animationFrames),
}

const roomFrame = Subscription.make(
  'RoomFrame',
  Stream.map(roomFrameTimes, nowMs => Message.TickedRoomFrame({ nowMs })),
)

const gamepad = Subscription.make(
  'Gamepad',
  Stream.suspend(() => (hasGamepads() ? gamepadMessages : Stream.empty)),
)

const padRepeat = Subscription.make(
  'PadRepeat',
  Stream.suspend(() => (hasGamepads() ? padRepeats : Stream.empty)),
)

const keyboard = Subscription.make('Keyboard', keyboardMessages)

const keyWatch = Subscription.make('KeyWatch', keyWatchMessages)

const windowBlur = Subscription.make(
  'WindowBlur',
  windowEvents('blur', maybeWindowBlurMessage),
)

const pageVisibility = Subscription.make(
  'PageVisibility',
  documentEvents('visibilitychange', () =>
    Option.some(pageVisibilityMessage(document.visibilityState)),
  ),
)

const windowFocus = Subscription.make(
  'WindowFocus',
  windowEvents('focus', maybeWindowFocusMessage),
)

const pageRestores = Subscription.make(
  'PageRestores',
  windowEvents('pageshow', maybePageShowMessage),
)

const updateCheck = Subscription.make('UpdateCheck', updateCheckMessages)

const mouseAim = Subscription.make('MouseAim', mouseMessages)

const pointerReleases = Subscription.make(
  'PointerReleases',
  pointerReleaseMessages,
)

const fullscreenChanges = Subscription.make(
  'FullscreenChanges',
  documentEvents('fullscreenchange', () =>
    Option.some(
      Message.ChangedFullscreen({
        fullscreen: document.fullscreenElement === null ? 'Off' : 'On',
      }),
    ),
  ),
)

const trackedPointers = Subscription.make(
  'TrackedPointers',
  pointerMoveMessages,
)

type AppSubscription = Subscription.Subscription<
  Message,
  PlayerStore | InstallPrompt | CoopNet
>

const ALWAYS: ReadonlyArray<AppSubscription> = [
  playerSync,
  today,
  installOffers,
  gamepad,
  keyboard,
  keyWatch,
  windowBlur,
  pageVisibility,
  windowFocus,
  pageRestores,
  pointerReleases,
  fullscreenChanges,
]

// NOTE: the Subscriptions the Model asks for, each gated on it: the frame
// while a round or a screen moves (at its pace), the room's frame while its
// game plays, the pad's repeats while a menu is up, the update check in its
// window, the mouse's aim while a round is on, and a tracked pointer's
// moves. `subscriptions` runs after every Message, every frame too, so each
// list of gates is built once and kept by its gates' bits: a frame builds
// no Subscription and no list.
const listsByGates = new Map<number, ReadonlyArray<AppSubscription>>()

const listFor = (
  gates: number,
  build: () => ReadonlyArray<AppSubscription>,
): ReadonlyArray<AppSubscription> =>
  Option.getOrElse(Option.fromUndefinedOr(listsByGates.get(gates)), () => {
    const built = build()
    listsByGates.set(gates, built)
    return built
  })

const bit = (isOn: boolean, value: number): number => (isOn ? value : 0)

export const subscriptions = ({
  model,
}: Readonly<{ model: Model }>): ReadonlyArray<AppSubscription> => {
  const isFrameOn = isFrameActive(model)
  const pace = framePaceOf(model)
  const isRoomOn = isRoomFrameDue(model)
  const isRepeatOn = isPadMenuUp(model)
  const isCheckOn = updateCheckActivity(model) === 'Active'
  const isAimOn = playingActivity(model) === 'Active'
  const isTrackOn = pointerTrackingActivity(model) === 'Active'
  const gates =
    bit(isFrameOn, 1) +
    bit(pace === 'Menu', 2) +
    bit(isRoomOn, 4) +
    bit(isRepeatOn, 8) +
    bit(isCheckOn, 16) +
    bit(isAimOn, 32) +
    bit(isTrackOn, 64)
  const gated = listFor(gates, () => [
    ...ALWAYS,
    ...(isFrameOn ? [frames[pace]] : []),
    ...(isRoomOn ? [roomFrame] : []),
    ...(isRepeatOn ? [padRepeat] : []),
    ...(isCheckOn ? [updateCheck] : []),
    ...(isAimOn ? [mouseAim] : []),
    ...(isTrackOn ? [trackedPointers] : []),
  ])
  // NOTE: co-op's own (QUICK PLAY's queue, a room's lobby and socket), keyed
  // by the room's code, so they join the list only while co-op has one: a
  // frame in single player builds no list.
  const coop = Array.filter(
    coopSubscriptions(model.coop),
    (entry): entry is Exclude<typeof entry, false> => entry !== false,
  )
  return Array.isReadonlyArrayNonEmpty(coop) ? [...gated, ...coop] : gated
}
