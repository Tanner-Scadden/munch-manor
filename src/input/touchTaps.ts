import { Function } from 'effect'

import * as DetMath from '../shared/detMath'

export const TAP_MAX_MS = 600
export const TAP_SLOP_PX = 12
export const CLICK_ECHO_MS = 800

type Press = Readonly<{
  target: Element
  x: number
  y: number
  timeStamp: number
}>

const isTouch = (event: PointerEvent): boolean => event.pointerType === 'touch'

const commonAncestor = (a: Element, b: Element): Element | null => {
  for (let node: Element | null = a; node !== null; node = node.parentElement) {
    if (node.contains(b)) {
      return node
    }
  }
  return null
}

const isInert = (element: Element): boolean =>
  element.closest('[inert]') !== null

export const listenForTouchTaps: {
  (onTap: () => void): (root: HTMLElement) => () => void
  (root: HTMLElement, onTap: () => void): () => void
} = Function.dual(2, (root: HTMLElement, onTap: () => void): (() => void) => {
  const presses = new Map<number, Press>()
  let echoUntil = -Infinity
  let isDispatching = false

  const onPointerDown = (event: PointerEvent): void => {
    if (isTouch(event) && event.target instanceof Element) {
      presses.set(event.pointerId, {
        target: event.target,
        x: event.clientX,
        y: event.clientY,
        timeStamp: event.timeStamp,
      })
    }
  }

  const onPointerCancel = (event: PointerEvent): void => {
    presses.delete(event.pointerId)
  }

  const onPointerUp = (event: PointerEvent): void => {
    const press = presses.get(event.pointerId)
    presses.delete(event.pointerId)
    if (press === undefined || !isTouch(event)) {
      return
    }
    const isHeld = event.timeStamp - press.timeStamp > TAP_MAX_MS
    const isDragged =
      DetMath.hypot(event.clientX - press.x, event.clientY - press.y) >
      TAP_SLOP_PX
    if (isHeld || isDragged) {
      return
    }
    const lifted = root.ownerDocument.elementFromPoint(
      event.clientX,
      event.clientY,
    )
    const target = lifted === null ? null : commonAncestor(press.target, lifted)
    if (
      target === null ||
      !root.contains(target) ||
      !target.isConnected ||
      isInert(target) ||
      !(target instanceof HTMLElement)
    ) {
      return
    }
    echoUntil = event.timeStamp + CLICK_ECHO_MS
    isDispatching = true
    try {
      target.click()
    } finally {
      isDispatching = false
    }
    onTap()
  }

  const onClick = (event: MouseEvent): void => {
    if (!isDispatching && event.detail > 0 && event.timeStamp <= echoUntil) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }

  const capture = { capture: true }
  root.addEventListener('pointerdown', onPointerDown, capture)
  root.addEventListener('pointerup', onPointerUp, capture)
  root.addEventListener('pointercancel', onPointerCancel, capture)
  root.addEventListener('click', onClick, capture)
  return () => {
    root.removeEventListener('pointerdown', onPointerDown, capture)
    root.removeEventListener('pointerup', onPointerUp, capture)
    root.removeEventListener('pointercancel', onPointerCancel, capture)
    root.removeEventListener('click', onClick, capture)
    presses.clear()
  }
})
