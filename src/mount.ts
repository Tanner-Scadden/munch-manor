import { Effect, Queue, Stream } from 'effect'

import { ApplicationDefinition } from './definition'
import {
  type MeasuredGameSurface,
  Message,
  type SettledShare,
  type TappedWithTouch,
} from './message'
import type { ShareOutcome } from './model'
import { GAME_URL, type SharePost, copiedLineOf } from './share'
import { listenForTouchTaps } from './touchTaps'

const measure = (element: Element): MeasuredGameSurface => {
  const { left, top, width, height } = element.getBoundingClientRect()
  return Message.MeasuredGameSurface({ left, top, width, height })
}

// NOTE: the game surface's place on the page, measured when it mounts and
// again whenever it or the window resizes, so pointer input maps onto it.
export const MeasureGameSurface = ApplicationDefinition.makeMountStream(
  'MeasureGameSurface',
  {
    messages: [Message.MeasuredGameSurface],
    handler: function* () {
      return ({ element }) =>
        Stream.callback<MeasuredGameSurface>(queue =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const emitMeasurement = (): void => {
                Queue.offerUnsafe(queue, measure(element))
              }
              const resizeObserver = new ResizeObserver(emitMeasurement)
              resizeObserver.observe(element)
              window.addEventListener('resize', emitMeasurement)
              window.visualViewport?.addEventListener('resize', emitMeasurement)
              return { resizeObserver, emitMeasurement }
            }),
            ({ resizeObserver, emitMeasurement }) =>
              Effect.sync(() => {
                resizeObserver.disconnect()
                window.removeEventListener('resize', emitMeasurement)
                window.visualViewport?.removeEventListener(
                  'resize',
                  emitMeasurement,
                )
              }),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
    },
  },
)

// NOTE: taps on touch screens come from each finger's own pointer events,
// so a button works with another finger on the glass (src/touchTaps.ts).
// The tapped button's own OnClick sends its Message; this Mount only says a
// finger tapped.
export const ListenForTouchTaps = ApplicationDefinition.makeMountStream(
  'ListenForTouchTaps',
  {
    messages: [Message.TappedWithTouch],
    handler: function* () {
      return ({ element }) =>
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
        )
    },
  },
)

// SHARE

// NOTE: the end screen's SHARE button carries its post's words here, read
// at the tap, so the post is always the run on screen
// (`data-share-text`).
export const SHARE_TEXT_DATA = 'share-text'

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError'

// NOTE: no share sheet, or one the browser refused: the post goes to the
// clipboard. A browser with no clipboard (an insecure page) throws.
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

// NOTE: the share sheet where the browser has one, else the clipboard. A
// player who closes the sheet is Cancelled; a sheet the browser refuses
// (NotAllowedError) or that fails copies instead.
const sharePost = (post: SharePost): Promise<ShareOutcome> =>
  typeof navigator.share === 'function'
    ? navigator.share(post).then(
        (): ShareOutcome => 'Shared',
        (error: unknown) =>
          isAbort(error) ? Promise.resolve('Cancelled') : copyPost(post),
      )
    : copyPost(post)

// NOTE: listens on SHARE until the returned function is called, and calls
// `onSettled` with how each tap ended. navigator.share and the clipboard
// both need the tap's user activation, and iOS Safari, the owner's phone
// and installed app, refused navigator.share from the Command that ran a
// microtask after update. So the call is made here, on the click's own
// stack: the tap (src/touchTaps.ts makes it a click), a mouse click, or
// Enter on the focused button. The button's OnClick still sends
// ClickedShareButton, which counts the share.
export const listenForShareClicks = (
  element: Element,
  onSettled: (outcome: ShareOutcome) => void,
): (() => void) => {
  const onClick = (): void => {
    const text = element.getAttribute(`data-${SHARE_TEXT_DATA}`) ?? ''
    void sharePost({ text, url: GAME_URL }).then(onSettled)
  }
  element.addEventListener('click', onClick)
  return () => {
    element.removeEventListener('click', onClick)
  }
}

export const ShareFromClick = ApplicationDefinition.makeMountStream(
  'ShareFromClick',
  {
    messages: [Message.SettledShare],
    handler: function* () {
      return ({ element }) =>
        Stream.callback<SettledShare>(queue =>
          Effect.acquireRelease(
            Effect.sync(() =>
              listenForShareClicks(element, outcome => {
                Queue.offerUnsafe(queue, Message.SettledShare({ outcome }))
              }),
            ),
            stopListening => Effect.sync(stopListening),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
    },
  },
)

export const mounts = [MeasureGameSurface, ListenForTouchTaps, ShareFromClick]
