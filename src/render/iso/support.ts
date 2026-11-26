const UNSUPPORTED_TITLE = "THIS DEVICE CAN'T DRAW THE MANOR"
const UNSUPPORTED_LINE =
  'Munch Manor needs WebGL2. Try a newer browser or another device.'

export const canDrawWorld = (): boolean => {
  if (typeof document === 'undefined') {
    return false
  }
  try {
    return document.createElement('canvas').getContext('webgl2') !== null
  } catch {
    return false
  }
}

export const unsupportedNode = (): HTMLElement => {
  const box = document.createElement('div')
  box.className = 'unsupported'
  box.setAttribute('role', 'alert')
  const title = document.createElement('p')
  title.className = 'unsupported-title'
  title.textContent = UNSUPPORTED_TITLE
  const line = document.createElement('p')
  line.textContent = UNSUPPORTED_LINE
  box.append(title, line)
  return box
}
