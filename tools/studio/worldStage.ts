// The live room's element, `<studio-world>`: the audit harness in a frame,
// showing the scene its `query` names through the game's own 3D renderer,
// with Munch Studio's marks over it (the tile grid, the hovered tile, the
// notes' areas) and the pixel loupe. The harness says where its camera is and
// hands over the world's pixels through its bridge (./bridge.ts), so a press
// lands on the world tile under it and the loupe reads the very pixels drawn.
// It keeps a copy of the frame around the picked tiles in `.live-shot`, the
// picture a note sends.
import { Option, Schema, String } from 'effect'
import { CustomElement } from 'foldkit'

import { TILE_SIZE } from '../../src/shared/constants'
import { type BridgeView, type StudioBridge, bridgeOf } from './bridge'
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

export const studioWorld = CustomElement.define({
  tag: TAG,
  properties: { query: Schema.String, marks: Marks },
  events: {
    'hover-tile': Tile,
    'press-tile': Tile,
    'release-tile': Nothing,
    'leave-world': Nothing,
  },
})

// THE LOUPE

// NOTE: the loupe's window in game pixels, and how big each one is drawn.
const LOUPE_COLUMNS = 32
const LOUPE_ROWS = 20
const LOUPE_CELL = 8

// NOTE: a game pixel whose screen pixels differ by more than this in any
// channel is mixed: a half-pixel edge, a soft rim, or a smear.
const MIXED_SPREAD = 40

const GRID_COLOR = 'rgba(255, 255, 255, 0.16)'
const HOVER_COLOR = '#6fc3ff'
const MIXED_COLOR = '#ff2fd6'
const AREA_COLORS = {
  Open: { line: '#ffb020', fill: 'rgba(255, 176, 32, 0.16)' },
  Done: { line: '#3fbf6a', fill: 'rgba(63, 191, 106, 0.16)' },
  Draft: { line: '#4fa3ff', fill: 'rgba(79, 163, 255, 0.22)' },
}

// NOTE: the world's pixels around a picked area, in world pixels.
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

// NOTE: one game pixel read off the frame's pixels: its middle's color, and
// whether the screen pixels wholly inside it disagree.
const cellAt = (
  data: ImageData,
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

// THE ELEMENT

type Point = Readonly<{ x: number; y: number }>

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

// NOTE: how often a live (not still) scene's loupe and picture read the
// frame again, in animation frames.
const LIVE_READ_FRAMES = 12

// NOTE: mutable on purpose: a custom element is the browser's own mutable
// object, holding its frame and canvases while it is on the page. Built only
// when it is defined, since HTMLElement exists only in a browser.
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
    private readonly host = document.createElement('div')
    private readonly harness = document.createElement('iframe')
    private readonly marksCanvas = document.createElement('canvas')
    private readonly loupe = document.createElement('canvas')
    private readonly readout = document.createElement('p')
    private readonly shot = document.createElement('canvas')

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
      })
      this.marksCanvas.className = 'live-marks'
      this.loupe.className = 'live-loupe'
      this.loupe.width = LOUPE_COLUMNS * LOUPE_CELL
      this.loupe.height = LOUPE_ROWS * LOUPE_CELL
      this.readout.className = 'live-readout'
      this.shot.className = 'live-shot'
      this.marksCanvas.addEventListener('pointermove', event => {
        this.pointerAt(event)
      })
      this.marksCanvas.addEventListener('pointerdown', event => {
        this.pointerAt(event)
        if (this.latestMarks.tool === 'Pin' && this.lastTile !== null) {
          this.marksCanvas.setPointerCapture(event.pointerId)
          this.emit('press-tile', this.lastTile)
        }
      })
      this.marksCanvas.addEventListener('pointerup', () => {
        this.emit('release-tile', {})
        this.isShotDue = true
      })
      this.marksCanvas.addEventListener('pointerleave', () => {
        this.maybePointer = Option.none()
        this.lastTile = null
        this.isLoupeDue = true
        this.emit('leave-world', {})
      })
      this.host.append(this.harness, this.marksCanvas, this.loupe)
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

    // NOTE: a point on the frame (CSS pixels of the harness's page) as a
    // point in the world, by the camera the harness reports.
    private worldAt(view: BridgeView, point: Point): Point {
      return {
        x: view.cameraX + ((point.x - view.left) / view.width) * view.viewWidth,
        y:
          view.cameraY + ((point.y - view.top) / view.height) * view.viewHeight,
      }
    }

    private pointerAt(event: PointerEvent): void {
      const box = this.marksCanvas.getBoundingClientRect()
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

    private fitMarks(): CanvasRenderingContext2D | null {
      const ratio = window.devicePixelRatio
      const width = Math.round(this.marksCanvas.clientWidth * ratio)
      const height = Math.round(this.marksCanvas.clientHeight * ratio)
      if (
        this.marksCanvas.width !== width ||
        this.marksCanvas.height !== height
      ) {
        this.marksCanvas.width = width
        this.marksCanvas.height = height
      }
      const context = this.marksCanvas.getContext('2d')
      context?.setTransform(ratio, 0, 0, ratio, 0, 0)
      return context
    }

    private clearMarks(): void {
      this.fitMarks()?.clearRect(
        0,
        0,
        this.marksCanvas.width,
        this.marksCanvas.height,
      )
    }

    private drawMarks(view: BridgeView): void {
      const context = this.fitMarks()
      if (context === null) {
        return
      }
      context.clearRect(0, 0, this.marksCanvas.width, this.marksCanvas.height)
      const scale = view.width / view.viewWidth
      const screenX = (x: number): number =>
        view.left + (x - view.cameraX) * scale
      const screenY = (y: number): number =>
        view.top + (y - view.cameraY) * scale
      const marks = this.latestMarks
      if (marks.isGridOn) {
        context.fillStyle = GRID_COLOR
        const firstColumn = Math.ceil(view.cameraX / TILE_SIZE)
        const lastColumn = Math.floor(
          (view.cameraX + view.viewWidth) / TILE_SIZE,
        )
        for (let column = firstColumn; column <= lastColumn; column++) {
          context.fillRect(
            Math.round(screenX(column * TILE_SIZE)),
            view.top,
            1,
            view.height,
          )
        }
        const firstRow = Math.ceil(view.cameraY / TILE_SIZE)
        const lastRow = Math.floor((view.cameraY + view.viewHeight) / TILE_SIZE)
        for (let row = firstRow; row <= lastRow; row++) {
          context.fillRect(
            view.left,
            Math.round(screenY(row * TILE_SIZE)),
            view.width,
            1,
          )
        }
      }
      const areaBox = (area: TileArea) => ({
        x: screenX(area.left * TILE_SIZE),
        y: screenY(area.top * TILE_SIZE),
        width: (area.right - area.left + 1) * TILE_SIZE * scale,
        height: (area.bottom - area.top + 1) * TILE_SIZE * scale,
      })
      const drawArea = (
        area: TileArea,
        colors: Readonly<{ line: string; fill: string }>,
      ): void => {
        const box = areaBox(area)
        context.fillStyle = colors.fill
        context.fillRect(box.x, box.y, box.width, box.height)
        context.strokeStyle = colors.line
        context.lineWidth = 2
        context.strokeRect(box.x, box.y, box.width, box.height)
      }
      for (const { area, isDone } of marks.areas) {
        drawArea(area, isDone ? AREA_COLORS.Done : AREA_COLORS.Open)
      }
      if (marks.draft !== null) {
        drawArea(marks.draft, AREA_COLORS.Draft)
      }
      if (marks.hover !== null && marks.tool === 'Pin') {
        const box = areaBox({
          left: marks.hover.column,
          top: marks.hover.row,
          right: marks.hover.column,
          bottom: marks.hover.row,
        })
        context.strokeStyle = HOVER_COLOR
        context.lineWidth = 2
        context.strokeRect(box.x, box.y, box.width, box.height)
      }
      if (marks.tool === 'Loupe') {
        Option.map(this.maybePointer, pointer => {
          const world = this.worldAt(view, pointer)
          const left = screenX(Math.floor(world.x) - LOUPE_COLUMNS / 2)
          const top = screenY(Math.floor(world.y) - LOUPE_ROWS / 2)
          context.strokeStyle = MIXED_COLOR
          context.lineWidth = 1
          context.strokeRect(
            left,
            top,
            LOUPE_COLUMNS * scale,
            LOUPE_ROWS * scale,
          )
        })
      }
    }

    // NOTE: the world's frame copied, or none before the renderer is in.
    private snapshot(): Option.Option<HTMLCanvasElement> {
      return Option.flatMap(this.bridge(), bridge =>
        Option.fromNullishOr(bridge.snapshot()),
      )
    }

    // NOTE: the picture a note sends: the frame around the picked tiles, or
    // the whole frame with none; whether it could be taken yet.
    private takeShot(view: BridgeView): boolean {
      return Option.match(this.snapshot(), {
        onNone: () => false,
        onSome: frame => {
          const ratio = frame.width / view.viewWidth
          const draft = this.latestMarks.draft
          const left =
            draft === null
              ? view.cameraX
              : Math.max(view.cameraX, draft.left * TILE_SIZE - SHOT_MARGIN)
          const top =
            draft === null
              ? view.cameraY
              : Math.max(view.cameraY, draft.top * TILE_SIZE - SHOT_MARGIN)
          const right =
            draft === null
              ? view.cameraX + view.viewWidth
              : Math.min(
                  view.cameraX + view.viewWidth,
                  (draft.right + 1) * TILE_SIZE + SHOT_MARGIN,
                )
          const bottom =
            draft === null
              ? view.cameraY + view.viewHeight
              : Math.min(
                  view.cameraY + view.viewHeight,
                  (draft.bottom + 1) * TILE_SIZE + SHOT_MARGIN,
                )
          const width = Math.max(1, Math.round((right - left) * ratio))
          const height = Math.max(1, Math.round((bottom - top) * ratio))
          this.shot.width = width
          this.shot.height = height
          this.shot
            .getContext('2d')
            ?.drawImage(
              frame,
              Math.round((left - view.cameraX) * ratio),
              Math.round((top - view.cameraY) * ratio),
              width,
              height,
              0,
              0,
              width,
              height,
            )
          return true
        },
      })
    }

    // NOTE: the loupe over the game pixels around the pointer, each a big
    // square with the grid between them, mixed ones ringed in magenta; and
    // the readout under the room. Whether it could be drawn yet.
    private drawLoupe(view: BridgeView): boolean {
      const context = this.loupe.getContext('2d')
      if (context === null) {
        return true
      }
      if (Option.isNone(this.maybePointer)) {
        context.clearRect(0, 0, this.loupe.width, this.loupe.height)
        this.readout.textContent =
          '🔍 Hover the room: each square is one game pixel, magenta ones are mixed.'
        return true
      }
      const pointer = this.maybePointer.value
      return Option.match(this.snapshot(), {
        onNone: () => false,
        onSome: frame => {
          const ratio = frame.width / view.viewWidth
          const world = this.worldAt(view, pointer)
          const originX = Math.floor(world.x) - LOUPE_COLUMNS / 2
          const originY = Math.floor(world.y) - LOUPE_ROWS / 2
          const sourceX = (originX - view.cameraX) * ratio
          const sourceY = (originY - view.cameraY) * ratio
          const readLeft = Math.max(0, Math.floor(sourceX))
          const readTop = Math.max(0, Math.floor(sourceY))
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
          const reader = document.createElement('canvas')
          reader.width = readWidth
          reader.height = readHeight
          const readContext = reader.getContext('2d', {
            willReadFrequently: true,
          })
          if (readContext === null) {
            return true
          }
          readContext.drawImage(frame, -readLeft, -readTop)
          const data = readContext.getImageData(0, 0, readWidth, readHeight)
          context.clearRect(0, 0, this.loupe.width, this.loupe.height)
          const cells: Array<
            Readonly<{ column: number; row: number; cell: Cell }>
          > = []
          for (let row = 0; row < LOUPE_ROWS; row++) {
            for (let column = 0; column < LOUPE_COLUMNS; column++) {
              cells.push({
                column,
                row,
                cell: cellAt(
                  data,
                  sourceX - readLeft + column * ratio,
                  sourceY - readTop + row * ratio,
                  ratio,
                ),
              })
            }
          }
          let mixedCount = 0
          let middle: Cell = { red: 0, green: 0, blue: 0, isMixed: false }
          for (const { column, row, cell } of cells) {
            if (column === LOUPE_COLUMNS / 2 && row === LOUPE_ROWS / 2) {
              middle = cell
            }
            context.fillStyle = hexOf(cell)
            context.fillRect(
              column * LOUPE_CELL,
              row * LOUPE_CELL,
              LOUPE_CELL,
              LOUPE_CELL,
            )
          }
          context.fillStyle = 'rgba(0, 0, 0, 0.35)'
          for (let column = 1; column < LOUPE_COLUMNS; column++) {
            context.fillRect(column * LOUPE_CELL, 0, 1, this.loupe.height)
          }
          for (let row = 1; row < LOUPE_ROWS; row++) {
            context.fillRect(0, row * LOUPE_CELL, this.loupe.width, 1)
          }
          context.strokeStyle = MIXED_COLOR
          context.lineWidth = 2
          for (const { column, row, cell } of cells) {
            if (cell.isMixed) {
              mixedCount++
              context.strokeRect(
                column * LOUPE_CELL + 1,
                row * LOUPE_CELL + 1,
                LOUPE_CELL - 2,
                LOUPE_CELL - 2,
              )
            }
          }
          context.strokeStyle = '#ffffff'
          context.strokeRect(
            (LOUPE_COLUMNS / 2) * LOUPE_CELL,
            (LOUPE_ROWS / 2) * LOUPE_CELL,
            LOUPE_CELL,
            LOUPE_CELL,
          )
          const x = Math.floor(world.x)
          const y = Math.floor(world.y)
          this.readout.textContent = `x ${x}  y ${y}  ·  tile ${Math.floor(x / TILE_SIZE)}, ${Math.floor(y / TILE_SIZE)}  ·  ${hexOf(middle)}${middle.isMixed ? ' (mixed)' : ''}  ·  ${mixedCount} mixed of ${LOUPE_COLUMNS * LOUPE_ROWS}  ·  ${Math.round(ratio * 100) / 100} screen px a game px`
          return true
        },
      })
    }
  }

export const defineStudioWorld = (): void => {
  if (customElements.get(TAG) === undefined) {
    customElements.define(TAG, studioWorldClass())
  }
}
