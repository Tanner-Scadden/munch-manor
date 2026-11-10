// The art studio's page: the controls down the left, the big view and the
// gallery (or the room) in the middle, and the notes on the right.
import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'
import { type Html, createKeyedLazy } from 'foldkit/html'

import type { Facing } from '../../src/art/sprite'
import { TILE_SIZE } from '../../src/shared/constants'
import {
  type Backdrop,
  Message,
  type Model,
  StudioComposition,
  type StudioViewBuilder,
  freshDoneOf,
  notesFor,
} from './block'
import {
  type Bounds,
  type Entry,
  type Tone,
  entryById,
  sectionsOf,
} from './catalog'
import {
  backdropRect,
  frameIndexOf,
  frameOf,
  lookOf,
  padded,
  sizeOf,
  spritesBounds,
  zoomed,
} from './drawing'
import { inspectorView } from './inspectorView'
import type { Tile } from './notes'
import { areaShapes, pinAt } from './pins'
import { roomFrameOf, roomTargetOf, tileOfPin } from './room'
import { sidebarView } from './sidebarView'
import { stageView } from './stageView'
import { pickedEntry } from './update'

// GALLERY

const lazyCard = createKeyedLazy()

const CLOCK_STEP_MS = 100

// NOTE: one card, built only from its arguments, so the lazy card below can
// hand back the same card while none of them changed.
const cardView = (
  entry: Entry,
  index: number,
  clockKey: number,
  zoom: number,
  backdrop: Backdrop,
  facing: Facing,
  tone: Tone,
  isPicked: boolean,
  isFresh: boolean,
  openCount: number,
  h: StudioViewBuilder,
): Html => {
  const frames = entry.frames({
    facing,
    tone,
    clockMs: clockKey * CLOCK_STEP_MS,
  })
  const bounds = padded(spritesBounds(frames))
  const { width, height } = sizeOf(bounds, zoom)
  return h.button(
    [
      h.Key(entry.id),
      h.Class(`card${isPicked ? ' picked' : ''}${isFresh ? ' fresh' : ''}`),
      h.Title(entry.title),
      h.OnClick(Message.ClickedEntry({ id: entry.id })),
    ],
    [
      ...(isFresh
        ? [h.span([h.Class('badge fresh-badge')], ['✨ Updated'])]
        : []),
      ...(openCount > 0
        ? [h.span([h.Class('badge note-badge')], [`💬 ${openCount}`])]
        : []),
      Canvas.view(
        {
          key: entry.id,
          width,
          height,
          shapes: [
            backdropRect({ width, height }, backdrop),
            zoomed(frameOf(frames, index), bounds, zoom),
          ],
          className: 'sprite',
        },
        h,
      ),
      h.span([h.Class('card-title')], [entry.title]),
    ],
  )
}

// NOTE: the card redraws only when what it shows changes: its frame, the
// controls, or its badges. A clock-driven card (the stall) steps every
// CLOCK_STEP_MS; any other holds its clock at zero and steps by frame.
const card = (
  entry: Entry,
  model: Model,
  h: StudioViewBuilder,
): Html | null => {
  const count = entry.frames(lookOf(model)).length
  const index = frameIndexOf(entry, model.clockMs, count)
  const clockKey =
    entry.isClockDriven === true ? Math.floor(model.clockMs / CLOCK_STEP_MS) : 0
  return lazyCard(entry.id, cardView, [
    entry,
    index,
    clockKey,
    model.zoom,
    model.backdrop,
    model.facing,
    model.tone,
    Option.contains(model.maybeSelectedId, entry.id),
    Array.isReadonlyArrayNonEmpty(freshDoneOf(model, entry.id)),
    Array.filter(notesFor(model, entry.id), note => note.status === 'Open')
      .length,
    h,
  ])
}

const galleryView = (model: Model, h: StudioViewBuilder): Html =>
  h.main(
    [h.Class('middle')],
    [
      ...Option.match(pickedEntry(model), {
        onNone: () => [
          h.p(
            [h.Class('gallery-hint')],
            ['👆 Tap anything to see it big and ask for a change.'],
          ),
        ],
        onSome: entry => [stageView(model, entry, h)],
      }),
      h.div(
        [h.Class('gallery')],
        Array.map(sectionsOf(model.tab), section =>
          h.section(
            [h.Key(section.title)],
            [
              h.h2([], [section.title]),
              h.div(
                [h.Class('cards')],
                Array.map(section.entries, entry => card(entry, model, h)),
              ),
            ],
          ),
        ),
      ),
    ],
  )

// ROOMS

const GRID_COLOR = 'rgba(255, 255, 255, 0.14)'
const HOVER_COLOR = '#6fc3ff'

const tileBox = (tile: Tile, bounds: Bounds, zoom: number): Canvas.Shape =>
  Canvas.Rect({
    x: (tile.column * TILE_SIZE - bounds.left) * zoom,
    y: (tile.row * TILE_SIZE - bounds.top) * zoom,
    width: TILE_SIZE * zoom,
    height: TILE_SIZE * zoom,
    stroke: HOVER_COLOR,
    lineWidth: 2,
  })

const gridLines = (
  bounds: Bounds,
  zoom: number,
  width: number,
  height: number,
): ReadonlyArray<Canvas.Shape> => [
  ...Array.map(
    Array.range(
      Math.ceil(bounds.left / TILE_SIZE),
      Math.floor(bounds.right / TILE_SIZE),
    ),
    column =>
      Canvas.Rect({
        x: (column * TILE_SIZE - bounds.left) * zoom,
        y: 0,
        width: 1,
        height,
        fill: GRID_COLOR,
      }),
  ),
  ...Array.map(
    Array.range(
      Math.ceil(bounds.top / TILE_SIZE),
      Math.floor(bounds.bottom / TILE_SIZE),
    ),
    row =>
      Canvas.Rect({
        x: 0,
        y: (row * TILE_SIZE - bounds.top) * zoom,
        width,
        height: 1,
        fill: GRID_COLOR,
      }),
  ),
]

const roomView = (model: Model, h: StudioViewBuilder): Html => {
  const { shapes, bounds } = roomFrameOf(model)
  const frame = { bounds, zoom: model.zoom }
  const { width, height } = sizeOf(bounds, model.zoom)
  return h.main(
    [h.Class('middle')],
    [
      h.p(
        [h.Class('gallery-hint')],
        ['👆 Drag over the room to pick tiles for a note, or tap just one.'],
      ),
      h.div(
        [
          h.Class('stage-canvases room'),
          h.Style({ width: `${width}px`, height: `${height}px` }),
          h.OnMouseLeave(Message.LeftRoom()),
        ],
        [
          Canvas.view(
            {
              key: 'room-art',
              width,
              height,
              shapes: [
                backdropRect({ width, height }, model.backdrop),
                zoomed(shapes, bounds, model.zoom),
              ],
              className: 'sprite room-art',
            },
            h,
          ),
          Canvas.view(
            {
              key: 'room-pins',
              width,
              height,
              shapes: [
                ...(model.isGridOn
                  ? gridLines(bounds, model.zoom, width, height)
                  : []),
                ...Option.toArray(
                  Option.map(model.maybeHoverTile, tile =>
                    tileBox(tile, bounds, model.zoom),
                  ),
                ),
                ...areaShapes({
                  model,
                  notes: notesFor(model, roomTargetOf(model.room)),
                  frame,
                }),
              ],
              className: 'pins',
              onPointerMove: ({ x, y }) =>
                Message.HoveredTile({
                  tile: tileOfPin(pinAt(frame)({ x, y })),
                }),
              onPointerDown: ({ x, y }) =>
                Message.PressedRoomTile({
                  tile: tileOfPin(pinAt(frame)({ x, y })),
                }),
              onPointerUp: () => Message.ReleasedRoom(),
            },
            h,
          ),
        ],
      ),
    ],
  )
}

// NOTE: Foldkit knows a view by the very function makeView returns, so a
// dual wrapper would be a view it does not know.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const view = StudioComposition.makeView((model, h) => ({
  title: `Munch Studio: ${Option.match(
    Option.flatMap(model.maybeSelectedId, entryById),
    {
      onNone: () => model.tab,
      onSome: entry => entry.title,
    },
  )}`,
  body: h.div(
    [h.Class('studio')],
    [
      sidebarView(model, h),
      model.tab === 'Rooms' ? roomView(model, h) : galleryView(model, h),
      inspectorView(model, h),
    ],
  ),
}))
