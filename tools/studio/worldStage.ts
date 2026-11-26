import { Array, Effect, Option, Record, Schema, String } from 'effect'

import { Html } from '@effect/ui/html'

import { viewBoxOf as floorBoxOf } from '../../src/render/iso/cull'
import { type LensFrame, lensOf } from '../../src/render/lens'
import { TILE_SIZE } from '../../src/shared/constants'
import { toBrowserError } from '../../src/shared/describeError'
import { type BridgeView, type StudioBridge, bridgeOf } from './bridge'
import { LabEdits, tablesOf } from './lab'
import { HARNESS_PATH, LiveTool } from './liveScene'
import { Tile, TileArea } from './notes'

const TAG = 'studio-world'

const MarkedArea = Schema.Struct({
  area: TileArea,
  isDone: Schema.Boolean,
})

const Marks = Schema.Struct({
  tool: LiveTool,
  isGridOn: Schema.Boolean,
  hover: Schema.NullOr(Tile),
  draft: Schema.NullOr(TileArea),
  areas: Schema.Array(MarkedArea),
})
type Marks = typeof Marks.Type

const Nothing = Schema.Struct({})

export const studioWorld = Html.customElement({
  tag: TAG,
  properties: { query: Schema.String, marks: Marks, tuning: LabEdits },
  events: {
    'hover-tile': Tile,
    'press-tile': Tile,
    'release-tile': Nothing,
    'leave-world': Nothing,
  },
})

const LOUPE_COLUMNS = 32
const LOUPE_ROWS = 20
const LOUPE_CELL = 8

const MIXED_SPREAD = 40

const GRID_COLOR = 'rgba(255, 255, 255, 0.16)'
const HOVER_COLOR = '#6fc3ff'
const MIXED_COLOR = '#ff2fd6'
const AREA_COLORS = {
  Open: { line: '#ffb020', fill: 'rgba(255, 176, 32, 0.16)' },
  Done: { line: '#3fbf6a', fill: 'rgba(63, 191, 106, 0.16)' },
  Draft: { line: '#4fa3ff', fill: 'rgba(79, 163, 255, 0.22)' },
}

const SHOT_MARGIN = 40

type Cell = Readonly<{
  red: number
  green: number
  blue: number
  isMixed: boolean
}>

const hexPart = (channel: number): string =>
  `${channel < 16 ? '0' : ''}${channel.toString(16)}`

const hexOf = (cell: Cell): string =>
  `#${hexPart(cell.red)}${hexPart(cell.green)}${hexPart(cell.blue)}`

type Pixels = Readonly<{ data: Uint8Array; width: number; height: number }>

const cellAt = (
  data: Pixels,
  left: number,
  top: number,
  size: number,
): Cell => {
  const fromX = Math.ceil(left)
  const toX = Math.max(fromX + 1, Math.floor(left + size))
  const fromY = Math.ceil(top)
  const toY = Math.max(fromY + 1, Math.floor(top + size))
  const indexOf = (x: number, y: number): number =>
    (Math.min(data.height - 1, Math.max(0, y)) * data.width +
      Math.min(data.width - 1, Math.max(0, x))) *
    4
  const middle = indexOf(
    Math.floor(left + size / 2),
    Math.floor(top + size / 2),
  )
  let isMixed = false
  for (let y = fromY; y < toY && !isMixed; y++) {
    for (let x = fromX; x < toX && !isMixed; x++) {
      const index = indexOf(x, y)
      for (let channel = 0; channel < 3; channel++) {
        if (
          Math.abs(
            (data.data[index + channel] ?? 0) -
              (data.data[middle + channel] ?? 0),
          ) > MIXED_SPREAD
        ) {
          isMixed = true
        }
      }
    }
  }
  return {
    red: data.data[middle] ?? 0,
    green: data.data[middle + 1] ?? 0,
    blue: data.data[middle + 2] ?? 0,
    isMixed,
  }
}

const isFramebuffer = (value: unknown): value is WebGLFramebuffer | null =>
  value === null || typeof value === 'object'

const readFrame = (
  frame: HTMLCanvasElement,
  box: Readonly<{ left: number; top: number; width: number; height: number }>,
): Option.Option<Pixels> => {
  const gl = frame.getContext('webgl2') ?? frame.getContext('webgl')
  if (gl === null) {
    return Option.none()
  }
  const { left, top, width, height } = box
  const flipped = new Uint8Array(width * height * 4)
  const bound: unknown = gl.getParameter(gl.FRAMEBUFFER_BINDING)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.readPixels(
    left,
    frame.height - top - height,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    flipped,
  )
  if (isFramebuffer(bound)) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bound)
  }
  const rowBytes = width * 4
  const data = new Uint8Array(flipped.length)
  for (let row = 0; row < height; row++) {
    data.set(
      flipped.subarray(
        (height - 1 - row) * rowBytes,
        (height - row) * rowBytes,
      ),
      row * rowBytes,
    )
  }
  return Option.some({ data, width, height })
}

const showBitmap = (canvas: HTMLCanvasElement, bitmap: ImageBitmap): void => {
  const context = canvas.getContext('bitmaprenderer')
  if (context === null) {
    bitmap.close()
    return
  }
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  context.transferFromImageBitmap(bitmap)
}

const showWhenMade = (
  canvas: HTMLCanvasElement,
  make: () => Promise<ImageBitmap>,
  isCurrent: () => boolean,
): void => {
  Effect.runFork(
    Effect.tryPromise({ try: make, catch: toBrowserError }).pipe(
      Effect.match({
        onSuccess: bitmap => {
          if (isCurrent()) {
            showBitmap(canvas, bitmap)
          } else {
            bitmap.close()
          }
        },
        onFailure: () => undefined,
      }),
    ),
  )
}

const SVG = 'http://www.w3.org/2000/svg'

const svgOf = <K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] => {
  const element = document.createElementNS(SVG, tag)
  for (const [name, value] of Record.toEntries(attributes)) {
    element.setAttribute(name, value)
  }
  return element
}

const polygonsPath = (shapes: ReadonlyArray<ReadonlyArray<Point>>): string =>
  Array.join(
    Array.map(shapes, corners =>
      Array.isReadonlyArrayNonEmpty(corners)
        ? `${Array.join(
            Array.map(
              corners,
              (corner, index) =>
                `${index === 0 ? 'M' : 'L'}${corner.x} ${corner.y}`,
            ),
            ' ',
          )} Z`
        : '',
    ),
    ' ',
  )

const loupeGridPath = (): string =>
  Array.join(
    [
      ...Array.map(
        Array.range(1, LOUPE_COLUMNS - 1),
        column => `M${column * LOUPE_CELL + 0.5} 0 V${LOUPE_ROWS * LOUPE_CELL}`,
      ),
      ...Array.map(
        Array.range(1, LOUPE_ROWS - 1),
        row => `M0 ${row * LOUPE_CELL + 0.5} H${LOUPE_COLUMNS * LOUPE_CELL}`,
      ),
    ],
    ' ',
  )

type Point = Readonly<{ x: number; y: number }>

const lensViewOf = (view: BridgeView): LensFrame => ({
  x: view.cameraX,
  y: view.cameraY,
  width: view.viewWidth,
  height: view.viewHeight,
  scale: 1,
  left: 0,
  top: 0,
})

const floorToLens = (frame: LensFrame, point: Point): Point =>
  lensOf(frame).projectInto(point.x, point.y, { x: 0, y: 0 })

const viewPointAt = (view: BridgeView, point: Point): Point => ({
  x: ((point.x - view.left) / view.width) * view.viewWidth,
  y: ((point.y - view.top) / view.height) * view.viewHeight,
})

const shotBoxOf = (
  view: BridgeView,
  draft: TileArea | null,
): Readonly<{ left: number; top: number; right: number; bottom: number }> => {
  if (draft === null) {
    return { left: 0, top: 0, right: view.viewWidth, bottom: view.viewHeight }
  }
  const lens = lensViewOf(view)
  const corners = [
    floorToLens(lens, { x: draft.left * TILE_SIZE, y: draft.top * TILE_SIZE }),
    floorToLens(lens, {
      x: (draft.right + 1) * TILE_SIZE,
      y: draft.top * TILE_SIZE,
    }),
    floorToLens(lens, {
      x: draft.left * TILE_SIZE,
      y: (draft.bottom + 1) * TILE_SIZE,
    }),
    floorToLens(lens, {
      x: (draft.right + 1) * TILE_SIZE,
      y: (draft.bottom + 1) * TILE_SIZE,
    }),
  ]
  const xs = Array.map(corners, corner => corner.x)
  const ys = Array.map(corners, corner => corner.y)
  return {
    left: Math.max(0, Math.min(...xs) - SHOT_MARGIN),
    top: Math.max(0, Math.min(...ys) - SHOT_MARGIN),
    right: Math.min(view.viewWidth, Math.max(...xs) + SHOT_MARGIN),
    bottom: Math.min(view.viewHeight, Math.max(...ys) + SHOT_MARGIN),
  }
}

const sameTile = (a: Tile | null, b: Tile | null): boolean =>
  a === null || b === null ? a === b : a.column === b.column && a.row === b.row

const sameArea = (a: TileArea | null, b: TileArea | null): boolean =>
  a === null || b === null
    ? a === b
    : a.left === b.left &&
      a.top === b.top &&
      a.right === b.right &&
      a.bottom === b.bottom

const NO_MARKS: Marks = {
  tool: 'Pin',
  isGridOn: true,
  hover: null,
  draft: null,
  areas: [],
}

const LIVE_READ_FRAMES = 12

const studioWorldClass = () =>
  class StudioWorldElement extends HTMLElement {
    private latestQuery = ''
    private latestMarks: Marks = NO_MARKS
    private isBuilt = false
    private isOnPage = false
    private frameCount = 0
    private maybePointer: Option.Option<Point> = Option.none()
    private lastTile: Tile | null = null
    private isLoupeDue = false
    private isShotDue = false
    private latestTuning: LabEdits = {}
    private isTuneDue = false
    private readonly host = document.createElement('div')
    private readonly harness = document.createElement('iframe')
    private readonly marksLayer = svgOf('svg', { class: 'live-marks' })
    private readonly gridPath = svgOf('path', {
      fill: 'none',
      stroke: GRID_COLOR,
      'stroke-width': '1',
    })
    private readonly areaPaths = {
      Open: svgOf('path', {
        fill: AREA_COLORS.Open.fill,
        stroke: AREA_COLORS.Open.line,
        'stroke-width': '2',
      }),
      Done: svgOf('path', {
        fill: AREA_COLORS.Done.fill,
        stroke: AREA_COLORS.Done.line,
        'stroke-width': '2',
      }),
      Draft: svgOf('path', {
        fill: AREA_COLORS.Draft.fill,
        stroke: AREA_COLORS.Draft.line,
        'stroke-width': '2',
      }),
    }
    private readonly hoverPath = svgOf('path', {
      fill: 'none',
      stroke: HOVER_COLOR,
      'stroke-width': '2',
    })
    private readonly loupeBox = svgOf('rect', {
      fill: 'none',
      stroke: MIXED_COLOR,
      'stroke-width': '1',
    })
    private readonly loupe = document.createElement('div')
    private readonly loupePixels = document.createElement('canvas')
    private readonly loupeMarks = svgOf('svg', {
      class: 'live-loupe-marks',
      viewBox: `0 0 ${LOUPE_COLUMNS * LOUPE_CELL} ${LOUPE_ROWS * LOUPE_CELL}`,
    })
    private readonly loupeMixed = svgOf('path', {
      fill: 'none',
      stroke: MIXED_COLOR,
      'stroke-width': '2',
    })
    private readonly readout = document.createElement('p')
    private readonly shot = document.createElement('canvas')
    private shotToken = 0
    private loupeToken = 0

    get query(): string {
      return this.latestQuery
    }

    set query(next: string) {
      if (next === this.latestQuery) {
        return
      }
      this.latestQuery = next
      this.isShotDue = true
      this.harness.src = `${HARNESS_PATH}?${next}`
    }

    get marks(): Marks {
      return this.latestMarks
    }

    set marks(next: Marks) {
      if (!sameArea(next.draft, this.latestMarks.draft)) {
        this.isShotDue = true
      }
      if (next.tool !== this.latestMarks.tool) {
        this.isLoupeDue = true
      }
      this.latestMarks = next
    }

    get tuning(): LabEdits {
      return this.latestTuning
    }

    set tuning(next: LabEdits) {
      if (next === this.latestTuning) {
        return
      }
      this.latestTuning = next
      this.isTuneDue = true
    }

    connectedCallback(): void {
      this.isOnPage = true
      if (!this.isBuilt) {
        this.build()
      }
      requestAnimationFrame(() => this.tick())
    }

    disconnectedCallback(): void {
      this.isOnPage = false
    }

    private build(): void {
      this.isBuilt = true
      this.host.className = 'live-host'
      this.harness.className = 'live-frame'
      this.harness.title = 'The manor, live in 3D'
      this.harness.addEventListener('load', () => {
        this.isShotDue = true
        this.isTuneDue = true
      })
      this.marksLayer.append(
        this.gridPath,
        this.areaPaths.Open,
        this.areaPaths.Done,
        this.areaPaths.Draft,
        this.hoverPath,
        this.loupeBox,
      )
      this.loupe.className = 'live-loupe'
      this.loupePixels.className = 'live-loupe-pixels'
      this.loupePixels.width = LOUPE_COLUMNS
      this.loupePixels.height = LOUPE_ROWS
      this.loupeMarks.append(
        svgOf('path', {
          fill: 'none',
          stroke: 'rgba(0, 0, 0, 0.35)',
          'stroke-width': '1',
          d: loupeGridPath(),
        }),
        this.loupeMixed,
        svgOf('rect', {
          x: `${(LOUPE_COLUMNS / 2) * LOUPE_CELL}`,
          y: `${(LOUPE_ROWS / 2) * LOUPE_CELL}`,
          width: `${LOUPE_CELL}`,
          height: `${LOUPE_CELL}`,
          fill: 'none',
          stroke: '#ffffff',
          'stroke-width': '2',
        }),
      )
      this.loupe.append(this.loupePixels, this.loupeMarks)
      this.readout.className = 'live-readout'
      this.shot.className = 'live-shot'
      this.marksLayer.addEventListener('pointermove', event => {
        this.pointerAt(event)
      })
      this.marksLayer.addEventListener('pointerdown', event => {
        this.pointerAt(event)
        if (this.latestMarks.tool === 'Pin' && this.lastTile !== null) {
          this.marksLayer.setPointerCapture(event.pointerId)
          this.emit('press-tile', this.lastTile)
        }
      })
      this.marksLayer.addEventListener('pointerup', () => {
        this.emit('release-tile', {})
        this.isShotDue = true
      })
      this.marksLayer.addEventListener('pointerleave', () => {
        this.maybePointer = Option.none()
        this.lastTile = null
        this.isLoupeDue = true
        this.emit('leave-world', {})
      })
      this.host.append(this.harness, this.marksLayer, this.loupe)
      this.append(this.host, this.readout, this.shot)
    }

    private emit(name: string, detail: unknown): void {
      this.dispatchEvent(new CustomEvent(name, { detail }))
    }

    private bridge(): Option.Option<StudioBridge> {
      return bridgeOf(this.harness.contentWindow)
    }

    private view(): Option.Option<BridgeView> {
      return Option.flatMap(this.bridge(), bridge =>
        Option.fromNullishOr(bridge.view()),
      )
    }

    private worldAt(view: BridgeView, point: Point): Point {
      const at = viewPointAt(view, point)
      return lensOf(lensViewOf(view)).unprojectInto(at.x, at.y, { x: 0, y: 0 })
    }

    private pointerAt(event: PointerEvent): void {
      const box = this.marksLayer.getBoundingClientRect()
      const point = { x: event.clientX - box.left, y: event.clientY - box.top }
      this.maybePointer = Option.some(point)
      this.isLoupeDue = true
      Option.map(this.view(), view => {
        const world = this.worldAt(view, point)
        const tile = {
          column: Math.floor(world.x / TILE_SIZE),
          row: Math.floor(world.y / TILE_SIZE),
        }
        if (!sameTile(tile, this.lastTile)) {
          this.lastTile = tile
          this.emit('hover-tile', tile)
        }
      })
    }

    private tick(): void {
      if (!this.isOnPage) {
        return
      }
      this.frameCount++
      const isLiveRead =
        !String.includes('freeze=')(this.latestQuery) &&
        this.frameCount % LIVE_READ_FRAMES === 0
      Option.match(this.view(), {
        onNone: () => {
          this.clearMarks()
        },
        onSome: view => {
          if (this.isTuneDue) {
            this.isTuneDue = false
            this.isShotDue = true
            this.isLoupeDue = true
            Option.map(this.bridge(), bridge => {
              bridge.tune(tablesOf(this.latestTuning))
            })
          }
          this.drawMarks(view)
          if (this.isShotDue || isLiveRead) {
            this.isShotDue = !this.takeShot(view)
          }
          if (
            this.latestMarks.tool === 'Loupe' &&
            (this.isLoupeDue || isLiveRead)
          ) {
            this.isLoupeDue = !this.drawLoupe(view)
          }
        },
      })
      this.loupe.hidden = this.latestMarks.tool !== 'Loupe'
      this.readout.hidden = this.latestMarks.tool !== 'Loupe'
      requestAnimationFrame(() => this.tick())
    }

    private fitMarks(): void {
      const width = Math.max(1, this.marksLayer.clientWidth)
      const height = Math.max(1, this.marksLayer.clientHeight)
      const viewBox = `0 0 ${width} ${height}`
      if (this.marksLayer.getAttribute('viewBox') !== viewBox) {
        this.marksLayer.setAttribute('viewBox', viewBox)
      }
    }

    private clearMarks(): void {
      this.fitMarks()
      for (const path of [
        this.gridPath,
        this.areaPaths.Open,
        this.areaPaths.Done,
        this.areaPaths.Draft,
        this.hoverPath,
      ]) {
        path.setAttribute('d', '')
      }
      this.loupeBox.setAttribute('visibility', 'hidden')
    }

    private drawMarks(view: BridgeView): void {
      this.fitMarks()
      const scale = view.width / view.viewWidth
      const lens = lensViewOf(view)
      const screenAt = (world: Point): Point => {
        const at = floorToLens(lens, world)
        return { x: view.left + at.x * scale, y: view.top + at.y * scale }
      }
      const marks = this.latestMarks
      const gridLines: Array<ReadonlyArray<Point>> = []
      if (marks.isGridOn) {
        const floor = floorBoxOf(lens)
        const firstColumn = Math.ceil(floor.left / TILE_SIZE)
        const lastColumn = Math.floor(floor.right / TILE_SIZE)
        for (let column = firstColumn; column <= lastColumn; column++) {
          gridLines.push([
            screenAt({ x: column * TILE_SIZE, y: floor.top }),
            screenAt({ x: column * TILE_SIZE, y: floor.bottom }),
          ])
        }
        const firstRow = Math.ceil(floor.top / TILE_SIZE)
        const lastRow = Math.floor(floor.bottom / TILE_SIZE)
        for (let row = firstRow; row <= lastRow; row++) {
          gridLines.push([
            screenAt({ x: floor.left, y: row * TILE_SIZE }),
            screenAt({ x: floor.right, y: row * TILE_SIZE }),
          ])
        }
      }
      this.gridPath.setAttribute(
        'd',
        Array.join(
          Array.map(gridLines, ([from, to]) =>
            from === undefined || to === undefined
              ? ''
              : `M${from.x} ${from.y} L${to.x} ${to.y}`,
          ),
          ' ',
        ),
      )
      const outline = (area: TileArea): ReadonlyArray<Point> => {
        const left = area.left * TILE_SIZE
        const top = area.top * TILE_SIZE
        const right = (area.right + 1) * TILE_SIZE
        const bottom = (area.bottom + 1) * TILE_SIZE
        return [
          screenAt({ x: left, y: top }),
          screenAt({ x: right, y: top }),
          screenAt({ x: right, y: bottom }),
          screenAt({ x: left, y: bottom }),
        ]
      }
      this.areaPaths.Open.setAttribute(
        'd',
        polygonsPath(
          Array.map(
            Array.filter(marks.areas, ({ isDone }) => !isDone),
            ({ area }) => outline(area),
          ),
        ),
      )
      this.areaPaths.Done.setAttribute(
        'd',
        polygonsPath(
          Array.map(
            Array.filter(marks.areas, ({ isDone }) => isDone),
            ({ area }) => outline(area),
          ),
        ),
      )
      this.areaPaths.Draft.setAttribute(
        'd',
        polygonsPath(marks.draft === null ? [] : [outline(marks.draft)]),
      )
      this.hoverPath.setAttribute(
        'd',
        polygonsPath(
          marks.hover !== null && marks.tool === 'Pin'
            ? [
                outline({
                  left: marks.hover.column,
                  top: marks.hover.row,
                  right: marks.hover.column,
                  bottom: marks.hover.row,
                }),
              ]
            : [],
        ),
      )
      const maybeLoupe =
        marks.tool === 'Loupe' ? this.maybePointer : Option.none()
      this.loupeBox.setAttribute(
        'visibility',
        Option.isSome(maybeLoupe) ? 'visible' : 'hidden',
      )
      Option.map(maybeLoupe, pointer => {
        const at = viewPointAt(view, pointer)
        this.loupeBox.setAttribute(
          'x',
          `${view.left + (Math.floor(at.x) - LOUPE_COLUMNS / 2) * scale}`,
        )
        this.loupeBox.setAttribute(
          'y',
          `${view.top + (Math.floor(at.y) - LOUPE_ROWS / 2) * scale}`,
        )
        this.loupeBox.setAttribute('width', `${LOUPE_COLUMNS * scale}`)
        this.loupeBox.setAttribute('height', `${LOUPE_ROWS * scale}`)
      })
    }

    private snapshot(): Option.Option<HTMLCanvasElement> {
      return Option.flatMap(this.bridge(), bridge =>
        Option.fromNullishOr(bridge.snapshot()),
      )
    }

    private takeShot(view: BridgeView): boolean {
      return Option.match(this.snapshot(), {
        onNone: () => false,
        onSome: frame => {
          const ratio = frame.width / view.viewWidth
          const { left, top, right, bottom } = shotBoxOf(
            view,
            this.latestMarks.draft,
          )
          const width = Math.max(1, Math.round((right - left) * ratio))
          const height = Math.max(1, Math.round((bottom - top) * ratio))
          this.shotToken += 1
          const token = this.shotToken
          const bitmap = createImageBitmap(
            frame,
            Math.round(left * ratio),
            Math.round(top * ratio),
            width,
            height,
          )
          showWhenMade(
            this.shot,
            () => bitmap,
            () => token === this.shotToken,
          )
          return true
        },
      })
    }

    private drawLoupe(view: BridgeView): boolean {
      if (Option.isNone(this.maybePointer)) {
        this.loupeToken += 1
        this.loupePixels
          .getContext('bitmaprenderer')
          ?.transferFromImageBitmap(null)
        this.loupeMixed.setAttribute('d', '')
        this.readout.textContent =
          '🔍 Hover the room: each square is one game pixel, magenta ones are mixed.'
        return true
      }
      const pointer = this.maybePointer.value
      return Option.match(this.snapshot(), {
        onNone: () => false,
        onSome: frame => {
          const ratio = frame.width / view.viewWidth
          const at = viewPointAt(view, pointer)
          const sourceX = (Math.floor(at.x) - LOUPE_COLUMNS / 2) * ratio
          const sourceY = (Math.floor(at.y) - LOUPE_ROWS / 2) * ratio
          const readLeft = Math.min(
            frame.width - 1,
            Math.max(0, Math.floor(sourceX)),
          )
          const readTop = Math.min(
            frame.height - 1,
            Math.max(0, Math.floor(sourceY)),
          )
          const readWidth = Math.max(
            1,
            Math.min(
              frame.width - readLeft,
              Math.ceil(LOUPE_COLUMNS * ratio) + 2,
            ),
          )
          const readHeight = Math.max(
            1,
            Math.min(frame.height - readTop, Math.ceil(LOUPE_ROWS * ratio) + 2),
          )
          return Option.match(
            readFrame(frame, {
              left: readLeft,
              top: readTop,
              width: readWidth,
              height: readHeight,
            }),
            {
              onNone: () => true,
              onSome: data => {
                this.showLoupe(view, pointer, {
                  data,
                  sourceX: sourceX - readLeft,
                  sourceY: sourceY - readTop,
                  ratio,
                })
                return true
              },
            },
          )
        },
      })
    }

    private showLoupe(
      view: BridgeView,
      pointer: Point,
      read: Readonly<{
        data: Pixels
        sourceX: number
        sourceY: number
        ratio: number
      }>,
    ): void {
      const { data, sourceX, sourceY, ratio } = read
      const rgba = new Uint8ClampedArray(LOUPE_COLUMNS * LOUPE_ROWS * 4)
      const rings: Array<string> = []
      let middle: Cell = { red: 0, green: 0, blue: 0, isMixed: false }
      for (let row = 0; row < LOUPE_ROWS; row++) {
        for (let column = 0; column < LOUPE_COLUMNS; column++) {
          const cell = cellAt(
            data,
            sourceX + column * ratio,
            sourceY + row * ratio,
            ratio,
          )
          const at = (row * LOUPE_COLUMNS + column) * 4
          rgba[at] = cell.red
          rgba[at + 1] = cell.green
          rgba[at + 2] = cell.blue
          rgba[at + 3] = 255
          if (column === LOUPE_COLUMNS / 2 && row === LOUPE_ROWS / 2) {
            middle = cell
          }
          if (cell.isMixed) {
            rings.push(
              `M${column * LOUPE_CELL + 1} ${row * LOUPE_CELL + 1} h${LOUPE_CELL - 2} v${LOUPE_CELL - 2} h${2 - LOUPE_CELL} Z`,
            )
          }
        }
      }
      this.loupeMixed.setAttribute('d', Array.join(rings, ' '))
      this.loupeToken += 1
      const token = this.loupeToken
      const pixels = new ImageData(rgba, LOUPE_COLUMNS, LOUPE_ROWS)
      showWhenMade(
        this.loupePixels,
        () => createImageBitmap(pixels),
        () => token === this.loupeToken,
      )
      const world = this.worldAt(view, pointer)
      const x = Math.floor(world.x)
      const y = Math.floor(world.y)
      this.readout.textContent = `x ${x}  y ${y}  ·  tile ${Math.floor(x / TILE_SIZE)}, ${Math.floor(y / TILE_SIZE)}  ·  ${hexOf(middle)}${middle.isMixed ? ' (mixed)' : ''}  ·  ${rings.length} mixed of ${LOUPE_COLUMNS * LOUPE_ROWS}  ·  ${Math.round(ratio * 100) / 100} screen px a game px`
    }
  }

export const defineStudioWorld = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, studioWorldClass())
  }
}
