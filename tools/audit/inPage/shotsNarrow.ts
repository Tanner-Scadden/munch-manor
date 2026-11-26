export const inspectNarrow = (min: number) => {
  const root =
    document.querySelector('dialog[open]') ??
    document.querySelector('.coop') ??
    document.body
  const label = (el: Element) => {
    const classes = globalThis.String(el.className)
    const name = el.getAttribute('aria-label') ?? el.textContent
    return `${el.tagName.toLowerCase()}.${classes.replaceAll(' ', '.')}:${name.trim().slice(0, 24)}`
  }
  const MAX_LISTED = 8
  const past: Array<string> = []
  const sideways: Array<string> = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const box = el.getBoundingClientRect()
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      el.closest('.sr-only, canvas, .world-window, .world-view') !== null
    ) {
      continue
    }
    if (
      past.length < MAX_LISTED &&
      (box.right > innerWidth + 1 || box.left < -1)
    ) {
      past.push(label(el))
    }
    if (
      sideways.length < MAX_LISTED &&
      el.scrollWidth > el.clientWidth + 1 &&
      el.clientWidth > 0 &&
      getComputedStyle(el).display !== 'inline'
    ) {
      sideways.push(label(el))
    }
  }
  const small: Array<string> = []
  if (min !== 0) {
    for (const el of root.querySelectorAll('button')) {
      const height = el.getBoundingClientRect().height
      if (height > 0 && height < min) {
        small.push(label(el))
      }
    }
  }
  const scroller = document.scrollingElement ?? document.documentElement
  return {
    past,
    sideways,
    small,
    pageScrolls:
      scroller.scrollHeight > innerHeight + 1 ||
      scroller.scrollWidth > innerWidth + 1,
  }
}
