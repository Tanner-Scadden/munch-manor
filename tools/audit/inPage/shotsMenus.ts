export const readLayout = ({
  minSide,
  isPhone,
}: Readonly<{ minSide: number; isPhone: boolean }>) => {
  const openDialog = document.querySelector('dialog[open]')
  const scope: ParentNode = openDialog ?? document
  const width = window.innerWidth
  const height = window.innerHeight
  const small: Array<string> = []
  const outside: Array<string> = []
  for (const button of scope.querySelectorAll('button, a[href]')) {
    if (openDialog === null && button.closest('dialog') !== null) {
      continue
    }
    const box = button.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) {
      continue
    }
    const label = button.getAttribute('aria-label') ?? button.textContent.trim()
    if (isPhone && (box.width < minSide - 0.5 || box.height < minSide - 0.5)) {
      small.push(`${label} ${Math.round(box.width)}x${Math.round(box.height)}`)
    }
    if (
      box.left < -0.5 ||
      box.top < -0.5 ||
      box.right > width + 0.5 ||
      box.bottom > height + 0.5
    ) {
      outside.push(
        `${label} ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      )
    }
  }
  const clipped: Array<string> = []
  for (const element of scope.querySelectorAll('*')) {
    if (
      !(element instanceof HTMLElement) ||
      element.children.length > 0 ||
      element.closest('.sr-only') !== null
    ) {
      continue
    }
    const text = element.textContent.trim()
    if (text === '' || element.offsetWidth === 0) {
      continue
    }
    const style = getComputedStyle(element)
    if (style.overflow === 'visible' && style.textOverflow !== 'ellipsis') {
      continue
    }
    if (
      element.scrollWidth > element.clientWidth + 1 ||
      element.scrollHeight > element.clientHeight + 1
    ) {
      const head = text.slice(0, 24)
      clipped.push(
        `${element.className} "${head}" ${element.scrollWidth}x${element.scrollHeight} in ${element.clientWidth}x${element.clientHeight}`,
      )
    }
  }
  return {
    small,
    outside,
    clipped,
    pageScroll: document.documentElement.scrollHeight - window.innerHeight,
  }
}
