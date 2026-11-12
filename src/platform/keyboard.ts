import { Function } from 'effect'

// NOTE: a phone's on-screen keyboard. It overlays the page: index.html asks
// for `interactive-widget=overlays-content`, and Chrome's VirtualKeyboard
// API is told the same, so the page keeps its size and the game never
// squishes or turns. iOS keeps the page too and only shrinks the visual
// viewport. A field the keyboard would cover is lifted above it instead:
// the game and any open dialog slide up by `--keyboard-lift` (styles.css)
// while the field is focused, and back down when it lets go.

// NOTE: a field that brings up a phone's keyboard.
export const isTextField = (element: Element | null): boolean =>
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLInputElement &&
    ['text', 'search', 'email', 'tel', 'url', 'number', 'password'].includes(
      element.type,
    )) ||
  (element instanceof HTMLElement && element.isContentEditable)

// NOTE: room left between the field and the keyboard's top edge.
export const KEYBOARD_GAP_PX = 12

const KEYBOARD_LIFT_PROPERTY = '--keyboard-lift'

type Span = Readonly<{ top: number; bottom: number }>

// NOTE: how far up the page goes so the field, where it sits unlifted,
// clears the keyboard's top edge, and never so far that its top leaves the
// screen. Nothing when the keyboard covers none of it.
export const keyboardLift: {
  (keyboardTop: number): (field: Span) => number
  (field: Span, keyboardTop: number): number
} = Function.dual(2, (field: Span, keyboardTop: number): number =>
  Math.max(
    0,
    Math.min(
      field.bottom + KEYBOARD_GAP_PX - keyboardTop,
      field.top - KEYBOARD_GAP_PX,
    ),
  ),
)

type VirtualKeyboard = EventTarget &
  Readonly<{ boundingRect: DOMRectReadOnly }> & { overlaysContent: boolean }

const isVirtualKeyboard = (value: unknown): value is VirtualKeyboard =>
  value instanceof EventTarget &&
  'boundingRect' in value &&
  'overlaysContent' in value

const virtualKeyboardOf = (page: Window): VirtualKeyboard | undefined => {
  const keyboard: unknown = Reflect.get(page.navigator, 'virtualKeyboard')
  return isVirtualKeyboard(keyboard) ? keyboard : undefined
}

// NOTE: where the keyboard's top edge is on the page: the bottom of what
// iOS still shows, or the top of Chrome's keyboard.
const keyboardTopOf = (page: Window): number => {
  const viewport = page.visualViewport
  const visibleBottom =
    viewport === null ? page.innerHeight : viewport.offsetTop + viewport.height
  const keyboard = virtualKeyboardOf(page)
  const keyboardTop =
    keyboard !== undefined && keyboard.boundingRect.height > 0
      ? keyboard.boundingRect.top
      : Infinity
  return Math.min(visibleBottom, keyboardTop)
}

// NOTE: lifts the focused field over the keyboard until the returned
// function is called.
export const liftFieldsOverKeyboard = (page: Window): (() => void) => {
  const document = page.document
  const style = document.documentElement.style
  const lifted = { px: 0 }
  const keyboard = virtualKeyboardOf(page)
  if (keyboard !== undefined) {
    keyboard.overlaysContent = true
  }

  const setLift = (px: number): void => {
    if (px === lifted.px) {
      return
    }
    lifted.px = px
    if (px === 0) {
      style.removeProperty(KEYBOARD_LIFT_PROPERTY)
    } else {
      style.setProperty(KEYBOARD_LIFT_PROPERTY, `${px}px`)
    }
  }

  const liftFocusedField = (): void => {
    const field = document.activeElement
    if (field === null || !isTextField(field)) {
      setLift(0)
      return
    }
    const { top, bottom } = field.getBoundingClientRect()
    setLift(
      Math.round(
        keyboardLift(
          { top: top + lifted.px, bottom: bottom + lifted.px },
          keyboardTopOf(page),
        ),
      ),
    )
  }

  const onFocusOut = (event: FocusEvent): void => {
    const next = event.relatedTarget
    if (!(next instanceof Element && isTextField(next))) {
      setLift(0)
    }
  }

  document.addEventListener('focusin', liftFocusedField)
  document.addEventListener('focusout', onFocusOut)
  page.visualViewport?.addEventListener('resize', liftFocusedField)
  page.visualViewport?.addEventListener('scroll', liftFocusedField)
  keyboard?.addEventListener('geometrychange', liftFocusedField)
  return () => {
    document.removeEventListener('focusin', liftFocusedField)
    document.removeEventListener('focusout', onFocusOut)
    page.visualViewport?.removeEventListener('resize', liftFocusedField)
    page.visualViewport?.removeEventListener('scroll', liftFocusedField)
    keyboard?.removeEventListener('geometrychange', liftFocusedField)
    setLift(0)
  }
}
