import { Option } from 'effect'

// NOTE: the clipboard, for a Mount to call on a tap's own click. iOS
// Safari refuses the clipboard (and navigator.share) from a Command, which
// runs a microtask after update, outside the tap's user activation, so
// the call is made on the click's own stack (see SHARE in src/app/mount.ts).

// NOTE: older browsers, and pages that are not secure, have no async
// clipboard: a hidden read-only field is selected and copied the old way.
// Read-only keeps the phone's keyboard down.
const copyBySelection = (text: string): boolean => {
  const field = document.createElement('textarea')
  field.value = text
  field.readOnly = true
  field.setAttribute('aria-hidden', 'true')
  field.style.position = 'fixed'
  field.style.top = '0'
  field.style.left = '0'
  field.style.opacity = '0'
  field.style.pointerEvents = 'none'
  const focused = document.activeElement
  document.body.append(field)
  field.select()
  field.setSelectionRange(0, text.length)
  try {
    // NOTE: deprecated, and the only copy older Safari and WebViews have.
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
    if (focused instanceof HTMLElement) {
      focused.focus({ preventScroll: true })
    }
  }
}

const hasAsyncClipboard = (): boolean =>
  'clipboard' in navigator &&
  typeof navigator.clipboard.writeText === 'function'

// NOTE: whether `text` reached the clipboard.
export const copyToClipboard = (text: string): Promise<boolean> => {
  if (!hasAsyncClipboard()) {
    return Promise.resolve(copyBySelection(text))
  }
  try {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => copyBySelection(text),
    )
  } catch {
    return Promise.resolve(copyBySelection(text))
  }
}

// NOTE: the clipboard's text, or none when the browser has no clipboard to
// read or refuses (no permission, the Paste bubble dismissed). iOS shows
// its Paste bubble first.
export const readClipboard = (): Promise<Option.Option<string>> => {
  if (
    !('clipboard' in navigator) ||
    typeof navigator.clipboard.readText !== 'function'
  ) {
    return Promise.resolve(Option.none())
  }
  try {
    return navigator.clipboard.readText().then(
      text => Option.some(text),
      () => Option.none(),
    )
  } catch {
    return Promise.resolve(Option.none())
  }
}
