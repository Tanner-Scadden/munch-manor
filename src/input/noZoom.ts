import { Effect } from 'effect'

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
