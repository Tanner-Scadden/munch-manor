import { Effect, Function, Option, Queue, Stream } from 'effect'

import { Mount } from '@effect/ui'

import { copyToClipboard, readClipboard } from '../../platform/clipboard'

export const LINK_CODE_DATA = 'link-code'

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

export const CopyLinkCodeOnClick = Mount.makeStream(
  'CopyLinkCodeOnClick',
  { args: {} },
  (node: HTMLElement) =>
    Stream.callback<void>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          listenForCopyClicks(node, () => {
            Queue.offerUnsafe(queue, undefined)
          }),
        ),
        stopListening => Effect.sync(stopListening),
      ),
    ),
)

export const PasteLinkCodeOnTap = Mount.makeStream(
  'PasteLinkCodeOnTap',
  { args: {} },
  (node: HTMLElement) =>
    Stream.callback<Readonly<{ text: string; typed: string }>>(queue =>
      Effect.acquireRelease(
        Effect.sync(() =>
          listenForPasteTaps(node, (text, typed) => {
            Queue.offerUnsafe(queue, { text, typed })
          }),
        ),
        stopListening => Effect.sync(stopListening),
      ),
    ),
)
