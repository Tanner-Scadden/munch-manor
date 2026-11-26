import { Array, Clock, Effect, Option, Queue, Schema, Stream } from 'effect'

import { Subscription } from '@effect/ui'

import { isRoomFrameDue } from '#domain/onlineRun.ts'
import type { CoopNet } from '#features/coop/services/net.ts'
import { coopSubscriptions } from '#features/coop/subscriptions.ts'
import {
  MENU_REPEAT_DELAY_MS,
  MENU_REPEAT_MS,
  type PadDirection,
  isSamePoll,
  padDirection,
  pickPad,
} from '#input/gamepad.ts'
import { isTrackingPointer } from '#input/input.ts'
import type { Gamepad } from '#input/inputSchema.ts'
import {
  KEY_WATCH_QUIET_MS,
  isGrabbedKeyUp,
  isLetterKeyCode,
} from '#input/keyGrab.ts'
import type {
  DisconnectedGamepad,
  PolledGamepad,
  RepeatedPadDirection,
} from '#input/message.ts'
import { InstallPrompt } from '#platform/install.ts'
import { StoreEvent } from '#platform/save/playerSync.ts'
import { PlayerStore } from '#platform/save/store.ts'
import { todays } from '#platform/today.ts'
import {
  RUNNING_BUILD,
  UPDATE_CHECK_INTERVAL,
  isCheckingForUpdates,
  isUpdateCheckWindow,
} from '#platform/version.ts'
import { DARE_LIST_BUTTON_CLASS } from '#screens/game/dareListButton.ts'
import { isRunUnderway } from '#world/run/arrival.ts'
import { isRoundActive } from '#world/waves/waves.ts'

import {
  type FramePace,
  OPEN_GATE,
  framePaceOf,
  gateFor,
  gateFrame,
} from './frame/frameGate.ts'
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
} from './message.ts'
import type { Model } from './model.ts'
import { isPadMenuUp } from './update/padMenu.ts'
import { isScreenAnimated } from './update/run.ts'

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

export const isKeptFromBrowser = (keyDown: KeyDown): boolean =>
  (isLetterKeyCode(keyDown.code) ||
    Array.contains(BROWSER_DEFAULT_KEYS, keyDown.code)) &&
  !isLeftToPage(keyDown)

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

const touchesMessage = (event: TouchEvent): ChangedTouches =>
  Message.ChangedTouches({
    points: Array.map(Array.fromIterable(event.touches), touch => ({
      clientX: touch.clientX,
      clientY: touch.clientY,
    })),
  })

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

const syncMessageOf = (event: StoreEvent) =>
  StoreEvent.match(event, {
    SyncedSave: ({ save }) => Message.UpdatedSyncedSave({ save }),
    SyncStatus: ({ state }) => Message.UpdatedSyncStatus({ state }),
  })

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

const playerSync = Subscription.make(
  'PlayerSync',
  Stream.unwrap(
    Effect.gen(function* () {
      const store = yield* PlayerStore
      return Stream.map(store.events, syncMessageOf)
    }),
  ),
)

const today = Subscription.make(
  'Today',
  Stream.map(todays, day => Message.ChangedToday({ day })),
)

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
  const coop = Array.filter(
    coopSubscriptions(model.coop),
    (entry): entry is Exclude<typeof entry, false> => entry !== false,
  )
  return Array.isReadonlyArrayNonEmpty(coop) ? [...gated, ...coop] : gated
}
