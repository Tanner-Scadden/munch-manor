import { Function } from 'effect'
// NOTE: taps on touch screens, made from each finger's own pointer events
// instead of the browser's click.
//
// A browser makes a `click` from a touch only when that touch is a lone
// tap. With another finger on the glass (a thumb on the move stick, a palm
// on the edge of an iPhone), iOS WebKit and Chrome show the button pressed
// and never send the click, so every button that acts on OnClick did
// nothing. And a lone tap's click goes to whatever is under the finger when
// it lifts, so a press that began on a dialog's panel could close the
// dialog from its backdrop once the panel had moved.
//
// So on the game's root, a touch pointer that goes down and comes up as a
// tap (short, and still) clicks the nearest element that holds both where
// it went down and where it came up, as a mouse's click does. The button's
// own OnClick then runs, the same Message as a mouse click or Enter. The
// browser's own click for that touch, if one follows, is dropped, so a press
// acts once. Mouse, pen, and keyboard clicks are left alone.
//
// Every element inside the root gets this, so a new button needs nothing:
// the HUD's slots, the dialogs, co-op, and the end screens alike.

// NOTE: a held finger is not a tap: it is a thumb on a stick or a resting
// palm, and lifting it must not press what it rests on.
export const TAP_MAX_MS = 600
// NOTE: a finger that wanders this far has dragged, as a browser judges it.
export const TAP_SLOP_PX = 12
// NOTE: how long after a tap the browser's own click for it may still come.
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

// NOTE: listens on `root` until the returned function is called, and calls
// `onTap` after each tap it makes.
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
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > TAP_SLOP_PX
    if (isHeld || isDragged) {
      return
    }
    // NOTE: a touch's pointerup goes to where it went down, so where it came
    // up is looked up.
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

  // NOTE: the browser's own click for a tap already made. A keyboard's
  // click (Enter or Space on a button) has no detail, so it always counts.
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
