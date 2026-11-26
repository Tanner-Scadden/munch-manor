export const measurePixels = () => {
  const round = (value: number) => Math.round(value * 100) / 100
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  const cut = (text: string, length: number) => text.slice(0, length)
  const lower = (text: string) => text.toLowerCase()
  const trimmed = (text: string) => text.trim()
  const isPercent = (text: string): boolean => text.endsWith('%')
  const firstLayer = (text: string) => {
    const words: Array<string> = []
    let word = ''
    let depth = 0
    for (const letter of text) {
      if (depth === 0 && letter === ',') {
        break
      }
      if (depth === 0 && letter === ' ') {
        if (word !== '') {
          words.push(word)
        }
        word = ''
        continue
      }
      depth += letter === '(' ? 1 : letter === ')' ? -1 : 0
      word += letter
    }
    if (word !== '') {
      words.push(word)
    }
    return words
  }
  const probe = document.createElement('div')
  const probeChild = document.createElement('div')
  probe.style.cssText =
    'position:absolute;left:0;top:0;height:0;visibility:hidden;pointer-events:none'
  probeChild.style.height = '1px'
  probe.append(probeChild)
  const laidOut = (text: string, space: number, host: Element) => {
    host.append(probe)
    probe.style.width = `${space}px`
    probeChild.style.width = ''
    probeChild.style.width = text
    const width =
      probeChild.style.width === ''
        ? Number.NaN
        : Number.parseFloat(getComputedStyle(probeChild).width)
    probe.remove()
    return width
  }
  const controls: Array<Record<string, string | number | boolean>> = []
  for (const element of document.querySelectorAll(
    'button, [role=tab], input, dialog[open], .coop, .profile, .panel, h1, h2, h3',
  )) {
    if (!visible(element)) {
      continue
    }
    const box = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const dialog = element.closest('dialog')
    const inset =
      dialog === null
        ? { right: 0, top: 0 }
        : {
            right: dialog.getBoundingClientRect().right - box.right,
            top: box.top - dialog.getBoundingClientRect().top,
          }
    controls.push({
      tag: lower(element.tagName),
      cls: cut(element.className.toString(), 60),
      label: cut(
        trimmed(element.getAttribute('aria-label') ?? element.textContent),
        28,
      ),
      x: round(box.left),
      y: round(box.top),
      w: round(box.width),
      h: round(box.height),
      fromDialogRight: round(inset.right),
      fromDialogTop: round(inset.top),
      fontSize: style.fontSize,
      fontFamily: cut(style.fontFamily, 30),
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      color: style.color,
      background: style.backgroundColor,
      borderWidth: style.borderTopWidth,
      borderStyle: style.borderTopStyle,
      borderColor: style.borderTopColor,
      radius: style.borderTopLeftRadius,
      shadow: cut(style.boxShadow, 80),
      padding: style.padding,
      opacity: style.opacity,
      cursor: style.cursor,
      isDisabled: element instanceof HTMLButtonElement && element.disabled,
    })
  }
  const ratio = window.devicePixelRatio
  const borderBoxOf = (element: Element) => {
    const style = getComputedStyle(element)
    const side = (name: string) =>
      Number.parseFloat(style.getPropertyValue(name)) || 0
    const extra =
      style.boxSizing === 'border-box'
        ? { width: 0, height: 0 }
        : {
            width:
              side('padding-left') +
              side('padding-right') +
              side('border-left-width') +
              side('border-right-width'),
            height:
              side('padding-top') +
              side('padding-bottom') +
              side('border-top-width') +
              side('border-bottom-width'),
          }
    const width = Number.parseFloat(style.width) + extra.width
    const height = Number.parseFloat(style.height) + extra.height
    return Number.isFinite(width) && width > 0 && Number.isFinite(height)
      ? { width, height }
      : null
  }
  const zoomOf = (element: Element) => {
    const own = borderBoxOf(element)
    return own === null ? 1 : element.getBoundingClientRect().width / own.width
  }
  const fraction = (value: number) => round(Math.abs(value - Math.round(value)))
  const images: Array<Record<string, string | number | boolean>> = []
  const pushArt = (
    element: Element,
    kind: string,
    art: { width: number; height: number },
    drawn: { left: number; top: number; width: number; height: number },
  ) => {
    if (art.width <= 0 || art.height <= 0 || drawn.width <= 0) {
      return
    }
    const scaleX = (drawn.width * ratio) / art.width
    const scaleY = (drawn.height * ratio) / art.height
    const parentClass = element.parentElement?.className.toString()
    const zoom = zoomOf(element)
    images.push({
      tag: lower(element.tagName),
      kind,
      zoom: round(zoom),
      cls: cut(element.className.toString(), 60),
      parent: parentClass === undefined ? '' : cut(parentClass, 40),
      label: cut(
        trimmed(
          element.closest('[aria-label]')?.getAttribute('aria-label') ?? '',
        ),
        28,
      ),
      natural: art.width,
      artHeight: art.height,
      drawn: round(drawn.width),
      scale: round(drawn.width / art.width),
      deviceScaleX: round(scaleX),
      deviceScaleY: round(scaleY),
      offX: fraction(drawn.left * ratio),
      offY: fraction(drawn.top * ratio),
      isWhole:
        fraction(scaleX) <= 0.02 &&
        fraction(scaleY) <= 0.02 &&
        fraction(drawn.left * ratio) <= 0.05 &&
        fraction(drawn.top * ratio) <= 0.05,
      rendering: getComputedStyle(element).imageRendering,
    })
  }
  for (const element of document.querySelectorAll('img, canvas')) {
    if (!visible(element)) {
      continue
    }
    const box = element.getBoundingClientRect()
    const art =
      element instanceof HTMLImageElement
        ? { width: element.naturalWidth, height: element.naturalHeight }
        : element instanceof HTMLCanvasElement
          ? { width: element.width, height: element.height }
          : { width: 0, height: 0 }
    pushArt(element, 'image', art, box)
  }
  const svgSize = (url: string) => {
    const match = /viewBox=['"]0 0 ([0-9.]+) ([0-9.]+)['"]/.exec(
      decodeURIComponent(url),
    )
    return match === null
      ? null
      : { width: Number(match[1]), height: Number(match[2]) }
  }
  for (const element of document.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement) || !visible(element)) {
      continue
    }
    const style = getComputedStyle(element)
    const url = /url\("?(data:image\/svg\+xml[^")]*)"?\)/.exec(
      style.backgroundImage,
    )
    const source = url?.[1]
    if (source === undefined) {
      continue
    }
    const art = svgSize(source)
    if (art === null) {
      continue
    }
    const box = element.getBoundingClientRect()
    const own = borderBoxOf(element) ?? {
      width: element.offsetWidth,
      height: element.offsetHeight,
    }
    const zoom = own.width > 0 ? box.width / own.width : 1
    const borders = {
      left: Number.parseFloat(style.borderLeftWidth),
      right: Number.parseFloat(style.borderRightWidth),
      top: Number.parseFloat(style.borderTopWidth),
      bottom: Number.parseFloat(style.borderBottomWidth),
    }
    const borderLeft = borders.left * zoom
    const borderTop = borders.top * zoom
    const isContent = style.backgroundOrigin === 'content-box'
    const padding = (side: string) =>
      isContent ? Number.parseFloat(style.getPropertyValue(side)) : 0
    const padLeft = padding('padding-left') * zoom
    const padTop = padding('padding-top') * zoom
    const room = {
      width:
        (own.width -
          borders.left -
          borders.right -
          padding('padding-left') -
          padding('padding-right')) *
        zoom,
      height:
        (own.height -
          borders.top -
          borders.bottom -
          padding('padding-top') -
          padding('padding-bottom')) *
        zoom,
    }
    const length = (text: string | undefined, space: number) =>
      text === undefined || text === 'auto'
        ? null
        : laidOut(text, space / zoom, element) * zoom
    const [sizeX, sizeY] = firstLayer(style.backgroundSize)
    const aspect = art.width / art.height
    const fit =
      sizeX === 'contain' || sizeX === 'cover'
        ? (sizeX === 'cover' ? Math.max : Math.min)(
            room.width / art.width,
            room.height / art.height,
          )
        : null
    const givenX = length(sizeX, room.width)
    const givenY = length(sizeY, room.height)
    const width =
      fit !== null
        ? art.width * fit
        : (givenX ??
          (givenY === null
            ? Math.min(room.width, room.height * aspect)
            : givenY * aspect))
    const height = fit !== null ? art.height * fit : (givenY ?? width / aspect)
    const [positionX, positionY] = firstLayer(style.backgroundPosition)
    const place = (text: string | undefined, free: number) =>
      text === undefined
        ? 0
        : isPercent(text)
          ? (Number.parseFloat(text) / 100) * free
          : Number.parseFloat(text) * zoom
    pushArt(element, 'background', art, {
      left:
        box.left + borderLeft + padLeft + place(positionX, room.width - width),
      top:
        box.top + borderTop + padTop + place(positionY, room.height - height),
      width,
      height,
    })
  }
  return { controls, images }
}
