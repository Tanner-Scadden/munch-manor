// Whether this device can draw the world: the 3D renderer runs on WebGL2. A
// device without it is told so plainly, instead of a game that cannot draw.

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

// NOTE: the plain page a device with no WebGL2 sees, built with the DOM
// before any of the game loads, so it shows even where the game would fail.
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
