import { Effect, Function, Queue, Stream } from 'effect'

import { Mount } from '@effect/ui'

import {
  GAME_URL,
  SHARE_TEXT_DATA,
  SHARE_URL_DATA,
  type ShareOutcome,
  type SharePost,
  copiedLineOf,
} from '#features/end/share.ts'
import { listenForTouchTaps } from '#input/touchTaps.ts'
import { isTextField, liftFieldsOverKeyboard } from '#platform/keyboard.ts'

import {
  type MeasuredGameSurface,
  Message,
  type PressedPointer,
  type SettledShare,
  type TappedWithTouch,
} from './message.ts'

const measure = (element: Element): MeasuredGameSurface => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return Message.MeasuredGameSurface({
    left,
    top,
    width,
    height,
    pixelRatio: window.devicePixelRatio,
  })
}

export const steadyMeasurement: {
  (
    next: MeasuredGameSurface,
    isTyping: boolean,
  ): (last: MeasuredGameSurface | undefined) => MeasuredGameSurface | undefined
  (
    last: MeasuredGameSurface | undefined,
    next: MeasuredGameSurface,
    isTyping: boolean,
  ): MeasuredGameSurface | undefined
} = Function.dual(
  3,
  (
    last: MeasuredGameSurface | undefined,
    next: MeasuredGameSurface,
    isTyping: boolean,
  ): MeasuredGameSurface | undefined =>
    isTyping && last !== undefined && last.width === next.width
      ? undefined
      : next,
)

const measurements = (element: Element): Stream.Stream<MeasuredGameSurface> =>
  Stream.callback<MeasuredGameSurface>(queue =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const sent: { last: MeasuredGameSurface | undefined } = {
          last: undefined,
        }
        const emitMeasurement = (): void => {
          const maybeNext = steadyMeasurement(
            sent.last,
            measure(element),
            isTextField(element.ownerDocument.activeElement),
          )
          if (maybeNext !== undefined) {
            sent.last = maybeNext
            Queue.offerUnsafe(queue, maybeNext)
          }
        }
        const onFocusOut = (event: FocusEvent): void => {
          const next = event.relatedTarget
          if (
            !(next instanceof Element && isTextField(next)) &&
            (window.scrollX !== 0 || window.scrollY !== 0)
          ) {
            window.scrollTo(0, 0)
          }
        }
        const resizeObserver = new ResizeObserver(emitMeasurement)
        resizeObserver.observe(element)
        window.addEventListener('resize', emitMeasurement)
        window.visualViewport?.addEventListener('resize', emitMeasurement)
        element.ownerDocument.addEventListener('focusout', onFocusOut)
        const stopLifting = liftFieldsOverKeyboard(window)
        return {
          resizeObserver,
          emitMeasurement,
          onFocusOut,
          stopLifting,
        }
      }),
      ({ resizeObserver, emitMeasurement, onFocusOut, stopLifting }) =>
        Effect.sync(() => {
          stopLifting()
          resizeObserver.disconnect()
          window.removeEventListener('resize', emitMeasurement)
          window.visualViewport?.removeEventListener('resize', emitMeasurement)
          element.ownerDocument.removeEventListener('focusout', onFocusOut)
        }),
    ).pipe(Effect.flatMap(() => Effect.never)),
  )

const PRIMARY_MOUSE_BUTTON = 0

const presses = (element: Element): Stream.Stream<PressedPointer> =>
  Stream.fromEventListener<PointerEvent>(element, 'pointerdown').pipe(
    Stream.filter(
      event =>
        event.pointerType !== 'mouse' || event.button === PRIMARY_MOUSE_BUTTON,
    ),
    Stream.map(event =>
      Message.PressedPointer({
        pointerId: event.pointerId,
        device: event.pointerType === 'mouse' ? 'Mouse' : 'Touch',
        clientX: event.clientX,
        clientY: event.clientY,
      }),
    ),
  )

export const WatchGameSurface = Mount.makeStream(
  'WatchGameSurface',
  { args: {} },
  (element: Element) => Stream.merge(measurements(element), presses(element)),
)

export const PressGameSurface = Mount.makeStream(
  'PressGameSurface',
  { args: {} },
  (element: Element) => presses(element),
)

export const ListenForTouchTaps = Mount.makeStream(
  'ListenForTouchTaps',
  { args: {} },
  (element: Element) =>
    Stream.callback<TappedWithTouch>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          element instanceof HTMLElement
            ? listenForTouchTaps(element, () => {
                Queue.offerUnsafe(queue, Message.TappedWithTouch())
              })
            : () => undefined,
        ),
        stopListening => Effect.sync(stopListening),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
)

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

const copyPost = (post: SharePost): Promise<ShareOutcome> => {
  try {
    return navigator.clipboard.writeText(copiedLineOf(post)).then(
      (): ShareOutcome => 'Copied',
      (): ShareOutcome => 'Failed',
    )
  } catch {
    return Promise.resolve('Failed')
  }
}

const sharePost = (post: SharePost): Promise<ShareOutcome> =>
  typeof navigator.share === 'function'
    ? navigator.share(post).then(
        (): ShareOutcome => 'Shared',
        (error: unknown) =>
          isAbort(error) ? Promise.resolve('Cancelled') : copyPost(post),
      )
    : copyPost(post)

export const listenForShareClicks: {
  (onSettled: (outcome: ShareOutcome) => void): (element: Element) => () => void
  (element: Element, onSettled: (outcome: ShareOutcome) => void): () => void
} = Function.dual(
  2,
  (
    element: Element,
    onSettled: (outcome: ShareOutcome) => void,
  ): (() => void) => {
    const onClick = (): void => {
      const text = element.getAttribute(`data-${SHARE_TEXT_DATA}`) ?? ''
      const url = element.getAttribute(`data-${SHARE_URL_DATA}`) ?? GAME_URL
      void sharePost({ text, url }).then(onSettled)
    }
    element.addEventListener('click', onClick)
    return () => {
      element.removeEventListener('click', onClick)
    }
  },
)

export const ShareFromClick = Mount.makeStream(
  'ShareFromClick',
  { args: {} },
  (element: Element) =>
    Stream.callback<SettledShare>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          listenForShareClicks(element, outcome => {
            Queue.offerUnsafe(queue, Message.SettledShare({ outcome }))
          }),
        ),
        stopListening => Effect.sync(stopListening),
      ).pipe(Effect.flatMap(() => Effect.never)),
    ),
)
