export type Point = Readonly<{ x: number; y: number }>

export const missedCloseFace = ({
  selector,
  points,
}: Readonly<{
  selector: string
  points: ReadonlyArray<Readonly<{ name: string; point: Point }>>
}>) => {
  const button = document.querySelector(selector)
  const clipperOf = (element: Element | null): Element | null => {
    for (
      let at = element?.parentElement ?? null;
      at !== null;
      at = at.parentElement
    ) {
      const style = getComputedStyle(at)
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        return at
      }
    }
    return null
  }
  const clipper = clipperOf(button)
  const isClippedAway = (point: Point) => {
    if (clipper === null) {
      return false
    }
    const style = getComputedStyle(clipper)
    const box = clipper.getBoundingClientRect()
    const border = parseFloat(style.borderTopWidth)
    const top = box.top + border
    const bottom = box.bottom - border
    const left = box.left + border
    const right = box.right - border
    const corners = [
      {
        radius: style.borderTopLeftRadius,
        x: left,
        y: top,
        sx: 1,
        sy: 1,
      },
      {
        radius: style.borderTopRightRadius,
        x: right,
        y: top,
        sx: -1,
        sy: 1,
      },
      {
        radius: style.borderBottomLeftRadius,
        x: left,
        y: bottom,
        sx: 1,
        sy: -1,
      },
      {
        radius: style.borderBottomRightRadius,
        x: right,
        y: bottom,
        sx: -1,
        sy: -1,
      },
    ]
    return corners.some(corner => {
      const inner = Math.max(0, parseFloat(corner.radius) - border)
      const cx = corner.x + corner.sx * inner
      const cy = corner.y + corner.sy * inner
      const isInCornerSquare =
        (point.x - cx) * corner.sx < 0 && (point.y - cy) * corner.sy < 0
      return isInCornerSquare && Math.hypot(point.x - cx, point.y - cy) > inner
    })
  }
  const isMissed = ({ point }: { point: Point }) => {
    if (isClippedAway(point)) {
      return false
    }
    const hit = document.elementFromPoint(point.x, point.y)
    return button === null || hit === null || !button.contains(hit)
  }
  const describe = ({ name, point }: { name: string; point: Point }) => {
    const hit = document.elementFromPoint(point.x, point.y)
    return `${name} hits ${hit === null ? 'nothing' : `${hit.tagName.toLowerCase()}.${hit.className}`}`
  }
  const missed = points.filter(isMissed)
  return missed.map(describe)
}

export const closeOverlaps = ({
  selector,
  others,
  texts,
}: Readonly<{ selector: string; others: string; texts: string }>) => {
  const close = document.querySelector(selector)
  const dialog = document.querySelector('dialog[open]')
  if (close === null || dialog === null) {
    return []
  }
  const c = close.getBoundingClientRect()
  const crosses = (r: DOMRect) =>
    r.width > 0 &&
    r.height > 0 &&
    r.left < c.right - 0.5 &&
    r.right > c.left + 0.5 &&
    r.top < c.bottom - 0.5 &&
    r.bottom > c.top + 0.5
  const isShown = (element: Element) => {
    const style = getComputedStyle(element)
    return (
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      element.closest('.sr-only') === null
    )
  }
  const name = (element: Element) =>
    (
      element.getAttribute('aria-label') ??
      (element instanceof HTMLElement ? element.innerText : element.className)
    )
      .replace(/\s+/g, ' ')
      .slice(0, 40)
  const found: Array<string> = []
  for (const other of globalThis.Array.from(dialog.querySelectorAll(others))) {
    if (other === close || close.contains(other) || other.contains(close)) {
      continue
    }
    if (isShown(other) && crosses(other.getBoundingClientRect())) {
      found.push(`covers ${other.tagName.toLowerCase()} "${name(other)}"`)
    }
  }
  for (const text of globalThis.Array.from(dialog.querySelectorAll(texts))) {
    if (!isShown(text) || text.contains(close)) {
      continue
    }
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
    const rects: Array<DOMRect> = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.parentElement?.closest('.sr-only') ?? null) !== null) {
        continue
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      rects.push(...globalThis.Array.from(range.getClientRects()))
    }
    const boxes =
      text.matches('.shop-keeper, .look-preview, [role="tablist"]') ||
      rects.length === 0
        ? [text.getBoundingClientRect()]
        : rects
    if (boxes.some(crosses)) {
      found.push(`covers the text "${name(text)}"`)
    }
  }
  return found
}

export const shopShapeOf = () => {
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id)
  return {
    shops: document.querySelectorAll('dialog#shop').length,
    open: document.querySelectorAll('dialog[open]').length,
    repeated: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
  }
}

export const placeBuyButton = () => {
  const button = document.querySelector(
    'dialog[open] li[data-verdict="available"] button',
  )
  if (button === null) {
    return null
  }
  const box = button.getBoundingClientRect()
  const point = {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  }
  const hit = document.elementFromPoint(point.x, point.y)
  return {
    point,
    isHit: hit !== null && button.contains(hit),
    hit:
      hit === null
        ? 'nothing'
        : `${hit.tagName.toLowerCase()}.${hit.className} in ${hit.closest('dialog')?.id ?? 'no dialog'}`,
  }
}
