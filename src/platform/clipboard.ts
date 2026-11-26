import { Option } from 'effect'

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
