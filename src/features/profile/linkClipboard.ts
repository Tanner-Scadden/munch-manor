import { Effect, Function, Option, Queue, Stream } from 'effect'

import { copyToClipboard, readClipboard } from '../../platform/clipboard'
import { ProfileBlock } from './block'
import { Message } from './message'

type SucceededCopyLinkCode = typeof Message.SucceededCopyLinkCode.Type
type SucceededReadClipboard = typeof Message.SucceededReadClipboard.Type

// NOTE: the link code button carries its code here, read at the tap.
export const LINK_CODE_DATA = 'link-code'

// NOTE: listens on the link code button until the returned function is
// called, and copies its code on each click: a tap (src/input/touchTaps.ts
// makes it a click), a mouse click, or Enter. `onCopied` runs once the code
// is on the clipboard; a copy the browser refuses says nothing.
export const listenForCopyClicks: {
  (onCopied: () => void): (element: Element) => () => void
  (element: Element, onCopied: () => void): () => void
} = Function.dual(2, (element: Element, onCopied: () => void): (() => void) => {
  const onClick = (): void => {
    const code = element.getAttribute(`data-${LINK_CODE_DATA}`) ?? ''
    void copyToClipboard(code).then(isCopied => {
      if (isCopied) {
        onCopied()
      }
    })
  }
  element.addEventListener('click', onClick)
  return () => {
    element.removeEventListener('click', onClick)
  }
})

// NOTE: listens on the link code field until the returned function is
// called. A finger's tap reads the clipboard when the field is empty or the
// tap focuses it afresh, never while the player is typing in it, and hands
// `onRead` what it holds with what the field held at the tap. The update
// judges the paste. A mouse click leaves the clipboard alone: a desktop has
// its own paste, and Chrome would ask for permission.
export const listenForPasteTaps: {
  (
    onRead: (text: string, typed: string) => void,
  ): (element: Element) => () => void
  (element: Element, onRead: (text: string, typed: string) => void): () => void
} = Function.dual(
  2,
  (
    element: Element,
    onRead: (text: string, typed: string) => void,
  ): (() => void) => {
    const press = { isTouch: false, isFresh: false, isReading: false }
    const onPointerDown = (event: Event): void => {
      press.isTouch =
        event instanceof PointerEvent && event.pointerType === 'touch'
      press.isFresh = element.ownerDocument.activeElement !== element
    }
    const onClick = (): void => {
      const typed = element instanceof HTMLInputElement ? element.value : ''
      const isRead =
        press.isTouch && !press.isReading && (press.isFresh || typed === '')
      press.isTouch = false
      press.isFresh = false
      if (!isRead) {
        return
      }
      press.isReading = true
      void readClipboard().then(maybeText => {
        press.isReading = false
        Option.match(maybeText, {
          onNone: () => undefined,
          onSome: text => {
            onRead(text, typed)
          },
        })
      })
    }
    const capture = { capture: true }
    element.addEventListener('pointerdown', onPointerDown, capture)
    element.addEventListener('click', onClick)
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, capture)
      element.removeEventListener('click', onClick)
    }
  },
)

export const CopyLinkCodeOnClick = ProfileBlock.makeMountStream(
  'CopyLinkCodeOnClick',
  {
    messages: [Message.SucceededCopyLinkCode],
    handler: function* () {
      return ({ element }) =>
        Stream.callback<SucceededCopyLinkCode>(queue =>
          Effect.acquireRelease(
            Effect.sync(() =>
              listenForCopyClicks(element, () => {
                Queue.offerUnsafe(queue, Message.SucceededCopyLinkCode())
              }),
            ),
            stopListening => Effect.sync(stopListening),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
    },
  },
)

export const PasteLinkCodeOnTap = ProfileBlock.makeMountStream(
  'PasteLinkCodeOnTap',
  {
    messages: [Message.SucceededReadClipboard],
    handler: function* () {
      return ({ element }) =>
        Stream.callback<SucceededReadClipboard>(queue =>
          Effect.acquireRelease(
            Effect.sync(() =>
              listenForPasteTaps(element, (text, typed) => {
                Queue.offerUnsafe(
                  queue,
                  Message.SucceededReadClipboard({ text, typed }),
                )
              }),
            ),
            stopListening => Effect.sync(stopListening),
          ).pipe(Effect.flatMap(() => Effect.never)),
        )
    },
  },
)

export const linkMounts = [CopyLinkCodeOnClick, PasteLinkCodeOnTap]
