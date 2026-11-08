import { Effect } from 'effect'

// NOTE: iOS Safari ignores user-scalable=no, so a pinch or a quick double
// tap can still zoom the page mid-run. Safari fires its own gesture events
// for a pinch, and a two finger touchmove carries a scale: cancelling both
// keeps the game at its size. The listeners live for the page's life.
const cancel = (event: Event): void => {
  event.preventDefault()
}

const cancelPinch = (event: Event): void => {
  if (
    'scale' in event &&
    typeof event.scale === 'number' &&
    event.scale !== 1
  ) {
    event.preventDefault()
  }
}

export const preventPageZoom: Effect.Effect<void> = Effect.sync(() => {
  const options = { passive: false }
  document.addEventListener('gesturestart', cancel, options)
  document.addEventListener('gesturechange', cancel, options)
  document.addEventListener('gestureend', cancel, options)
  document.addEventListener('touchmove', cancelPinch, options)
  document.addEventListener('dblclick', cancel, options)
})
