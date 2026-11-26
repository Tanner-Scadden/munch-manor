export type CaptionDrawing = Readonly<{
  rows: ReadonlyArray<string>
  pixel: number
  color: string
  place: 'Top' | 'Middle' | 'Bottom'
  top: number | undefined
}>

export type Box = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export type Device = Readonly<{
  kind: 'Laptop' | 'Phone'
  outer: Box
  screen: Box
  crop: Box
  unit: number
}>

export type Base =
  | Readonly<{ kind: 'Camera'; src: string; crop: Box }>
  | Readonly<{ kind: 'Devices'; src: string; devices: ReadonlyArray<Device> }>
  | Readonly<{ kind: 'Frame'; src: string }>

export type Overlay = Readonly<{
  base: Base | undefined
  captions: ReadonlyArray<CaptionDrawing>
  dissolve: Readonly<{ src: string; alpha: number }> | undefined
  fade: number
  outline: string
  shadow: string
}>

export const paintOverlay = async ({
  base,
  captions,
  dissolve,
  fade,
  outline,
  shadow,
}: Overlay) => {
  const SVG = 'http://www.w3.org/2000/svg'
  const ratio = window.devicePixelRatio
  const width = Math.round(window.innerWidth * ratio)
  const height = Math.round(window.innerHeight * ratio)
  const id = 'director-overlay'
  const existing = document.getElementById(id)
  const svg =
    existing instanceof SVGSVGElement
      ? existing
      : document.body.appendChild(document.createElementNS(SVG, 'svg'))
  svg.id = id
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('shape-rendering', 'crispEdges')
  svg.style.cssText = `position:fixed;left:0;top:0;width:${width / ratio}px;height:${height / ratio}px;z-index:2147483647;pointer-events:none`
  const shapes: Array<SVGElement> = []
  const loads: Array<Promise<void>> = []
  const element = (
    tag: string,
    attributes: Readonly<Record<string, string | number>>,
  ): SVGElement => {
    const made = document.createElementNS(SVG, tag)
    for (const name of Object.keys(attributes)) {
      made.setAttribute(name, `${attributes[name]}`)
    }
    return made
  }
  const sizeOf = async (
    src: string,
  ): Promise<Readonly<{ width: number; height: number }>> => {
    const image = new Image()
    image.src = src
    await image.decode()
    return { width: image.naturalWidth, height: image.naturalHeight }
  }
  const imageOf = (
    src: string,
    attributes: Readonly<Record<string, string | number>>,
  ): SVGElement => {
    const image = element('image', attributes)
    loads.push(
      new Promise<void>(resolve => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => resolve(), { once: true })
      }),
    )
    image.setAttribute('href', src)
    return image
  }
  const cropped = (
    src: string,
    size: Readonly<{ width: number; height: number }>,
    crop: Box,
    into: Box,
    rendering: 'pixelated' | 'auto',
  ): SVGElement => {
    const view = element('svg', {
      x: into.x,
      y: into.y,
      width: into.width,
      height: into.height,
      viewBox: `${crop.x} ${crop.y} ${crop.width} ${crop.height}`,
      preserveAspectRatio: 'none',
    })
    view.append(
      imageOf(src, {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        preserveAspectRatio: 'none',
        style: `image-rendering:${rendering}`,
      }),
    )
    return view
  }
  const fill = (
    x: number,
    y: number,
    boxWidth: number,
    boxHeight: number,
    color: string,
  ) => {
    shapes.push(
      element('rect', {
        x,
        y,
        width: boxWidth,
        height: boxHeight,
        fill: color,
      }),
    )
  }
  const whole: Box = { x: 0, y: 0, width, height }
  if (base !== undefined) {
    const size = await sizeOf(base.src)
    switch (base.kind) {
      case 'Camera': {
        shapes.push(cropped(base.src, size, base.crop, whole, 'pixelated'))
        break
      }
      case 'Frame': {
        shapes.push(
          cropped(
            base.src,
            size,
            { x: 0, y: 0, width: size.width, height: size.height },
            whole,
            'auto',
          ),
        )
        break
      }
      case 'Devices': {
        fill(0, 0, width, height, '#160b24')
        const rings: ReadonlyArray<readonly [number, string]> = [
          [0.56, '#1d0f30'],
          [0.42, '#24123a'],
          [0.3, '#2b1749'],
        ]
        for (const [share, color] of rings) {
          shapes.push(
            element('circle', {
              cx: width / 2,
              cy: height / 2,
              r: Math.max(width, height) * share,
              fill: color,
              'shape-rendering': 'auto',
            }),
          )
        }
        for (const device of base.devices) {
          const { outer, screen, unit } = device
          const middle = outer.x + outer.width / 2
          fill(
            outer.x - unit,
            outer.y - unit,
            outer.width + unit * 2,
            outer.height + unit * 2,
            outline,
          )
          fill(outer.x, outer.y, outer.width, outer.height, '#3a3550')
          fill(outer.x, outer.y, outer.width, unit, '#5a5478')
          if (device.kind === 'Laptop') {
            const lipY = outer.y + outer.height + unit
            fill(
              outer.x - unit * 8,
              lipY,
              outer.width + unit * 16,
              unit * 4,
              outline,
            )
            fill(
              outer.x - unit * 7,
              lipY + unit,
              outer.width + unit * 14,
              unit * 2,
              '#5a5478',
            )
            fill(middle - unit * 10, lipY + unit, unit * 20, unit, '#3a3550')
          } else {
            fill(middle - unit * 3, outer.y + unit * 2, unit * 6, unit, outline)
            fill(
              middle - unit * 4,
              outer.y + outer.height - unit * 3,
              unit * 8,
              unit,
              '#5a5478',
            )
          }
          fill(
            screen.x - unit,
            screen.y - unit,
            screen.width + unit * 2,
            screen.height + unit * 2,
            outline,
          )
          shapes.push(cropped(base.src, size, device.crop, screen, 'auto'))
          fill(
            screen.x + unit * 2,
            screen.y + unit * 2,
            unit * 3,
            unit,
            'rgba(255, 255, 255, 0.35)',
          )
        }
        break
      }
    }
  }
  for (const caption of captions) {
    const { rows, pixel } = caption
    const columns = rows[0]?.length ?? 0
    const left = Math.round((width - columns * pixel) / 2 / pixel) * pixel
    const textHeight = rows.length * pixel
    const top =
      caption.top !== undefined
        ? Math.round(height * caption.top)
        : caption.place === 'Top'
          ? Math.round(height * 0.08)
          : caption.place === 'Bottom'
            ? Math.round(height * 0.86 - textHeight)
            : Math.round((height - textHeight) / 2)
    const filled = (x: number, y: number) => rows[y]?.[x] === '#'
    const inked = (x: number, y: number) =>
      filled(x, y) ||
      filled(x - 1, y) ||
      filled(x + 1, y) ||
      filled(x, y - 1) ||
      filled(x, y + 1)
    const runs = (
      from: number,
      to: number,
      y: number,
      colorAt: (x: number) => string | undefined,
    ) => {
      let start = from
      while (start <= to) {
        const color = colorAt(start)
        let end = start
        while (end + 1 <= to && colorAt(end + 1) === color) {
          end++
        }
        if (color !== undefined) {
          fill(
            left + start * pixel,
            top + y * pixel,
            (end - start + 1) * pixel,
            pixel,
            color,
          )
        }
        start = end + 1
      }
    }
    for (let y = -1; y <= rows.length + 1; y++) {
      runs(-1, columns, y, x =>
        inked(x, y) ? outline : inked(x, y - 1) ? shadow : undefined,
      )
    }
    for (let y = 0; y < rows.length; y++) {
      runs(0, columns - 1, y, x => (filled(x, y) ? caption.color : undefined))
    }
  }
  if (dissolve !== undefined) {
    const size = await sizeOf(dissolve.src)
    const faded = cropped(
      dissolve.src,
      size,
      { x: 0, y: 0, width: size.width, height: size.height },
      whole,
      'auto',
    )
    faded.setAttribute('opacity', `${dissolve.alpha}`)
    shapes.push(faded)
  }
  if (fade > 0) {
    fill(0, 0, width, height, `rgba(0, 0, 0, ${fade})`)
  }
  svg.replaceChildren(...shapes)
  await Promise.all(loads)
}
