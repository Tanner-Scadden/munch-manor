export const readPortrait = () => {
  const isShown = (element: Element) => {
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return (
      box.width > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    )
  }
  const isInScroller = (element: Element): boolean => {
    const parent = element.parentElement
    if (parent === null) {
      return false
    }
    const overflow = getComputedStyle(parent).overflowY
    return (
      ((overflow === 'auto' || overflow === 'scroll') &&
        parent.scrollHeight > parent.clientHeight) ||
      isInScroller(parent)
    )
  }
  const openDialog = document.querySelector('dialog[open]')
  const buttons: Array<{
    name: string
    width: number
    height: number
    isHit: boolean
    isOnScreen: boolean
  }> = []
  for (const button of document.querySelectorAll<HTMLElement>(
    'button, a.home-support',
  )) {
    if (
      !isShown(button) ||
      (openDialog === null
        ? button.closest('dialog') !== null
        : !openDialog.contains(button))
    ) {
      continue
    }
    const box = button.getBoundingClientRect()
    const hit = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    )
    buttons.push({
      name: (button.getAttribute('aria-label') ?? button.innerText)
        .replace(/\s+/g, ' ')
        .slice(0, 40),
      width: Math.round(box.width),
      height: Math.round(box.height),
      isHit:
        (hit !== null && button.contains(hit)) ||
        (isInScroller(button) && (box.bottom > innerHeight || box.y < 0)),
      isOnScreen:
        isInScroller(button) ||
        (box.x >= -1 &&
          box.y >= -1 &&
          box.right <= innerWidth + 1 &&
          box.bottom <= innerHeight + 1),
    })
  }
  const scroller = document.scrollingElement ?? document.documentElement
  const pageScrolls = scroller.scrollHeight > innerHeight + 1
  let offScreen = 0
  for (const element of document.querySelectorAll(
    'dialog[open], dialog[open] > *',
  )) {
    const box = element.getBoundingClientRect()
    if (box.bottom > innerHeight + 1 || box.right > innerWidth + 1) {
      offScreen++
    }
  }
  return {
    buttons,
    pageScrolls,
    offScreen,
    layout:
      document.querySelector('.game-root')?.getAttribute('data-layout') ?? '',
  }
}
