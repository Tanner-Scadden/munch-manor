import { Array, Function, Option } from 'effect'

import type { Facing } from '../../src/art/sprite'
import { TILE_SIZE } from '../../src/shared/constants'
import {
  type Backdrop,
  Message,
  type Model,
  StudioDef,
  type StudioH,
  type StudioHtml,
  freshDoneOf,
  notesFor,
} from './block'
import { type Entry, type Tone, entryById, sectionsOf } from './catalog'
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
import { labToggleView, labView } from './labView'
import { harnessQueryOf } from './liveScene'
import {
  type PointerKind,
  type PointerOnPicture,
  marksView,
  picturePointer,
} from './marksView'
import type { Tile } from './notes'
import { studioPicture } from './picture'
import { type PictureFrame, areaMarksOf, pinAt } from './pins'
import { roomFrameOf, roomTargetOf, tileOfPin } from './room'
import { sidebarView } from './sidebarView'
import { stageView } from './stageView'
import { pickedEntry } from './update'
import { studioWorld } from './worldStage'

const CLOCK_STEP_MS = 100

const cardView = (
  h: StudioH,
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
): StudioHtml => {
  const frames = entry.frames({
    facing,
    tone,
    clockMs: clockKey * CLOCK_STEP_MS,
  })
  const bounds = padded(spritesBounds(frames))
  const { width, height } = sizeOf(bounds, zoom)
  return h.button
    .key(entry.id)
    .class('card', isPicked && 'picked', isFresh && 'fresh')
    .attr('title', entry.title)
    .on('click', Message.ClickedEntry({ id: entry.id }))
    .children(
      isFresh && h.span.class('badge fresh-badge').children('✨ Updated'),
      openCount > 0 &&
        h.span.class('badge note-badge').children(`💬 ${openCount}`),
      studioPicture(h)
        .class('sprite')
        .picture({
          key: `${entry.id}|${index}|${clockKey}|${zoom}|${backdrop}|${facing}|${tone}`,
          width,
          height,
          shapes: [
            backdropRect({ width, height }, backdrop),
            zoomed(frameOf(frames, index), bounds, zoom),
          ],
        }),
      h.span.class('card-title').children(entry.title),
    )
}

const card = (h: StudioH, entry: Entry, model: Model): StudioHtml => {
  const count = entry.frames(lookOf(model)).length
  const index = frameIndexOf(entry, model.clockMs, count)
  const clockKey =
    entry.isClockDriven === true ? Math.floor(model.clockMs / CLOCK_STEP_MS) : 0
  return h.lazy(
    cardView,
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
  )
}

const galleryView = (h: StudioH, model: Model): StudioHtml =>
  h.main.class('middle').children(
    Option.match(pickedEntry(model), {
      onNone: () =>
        h.p
          .class('gallery-hint')
          .children('👆 Tap anything to see it big and ask for a change.'),
      onSome: entry => stageView(h, model, entry),
    }),
    h.div
      .class('gallery')
      .children(
        Array.map(sectionsOf(model.tab), section =>
          h.section
            .key(section.title)
            .children(
              h.h2.children(section.title),
              h.div
                .class('cards')
                .children(
                  Array.map(section.entries, entry => card(h, entry, model)),
                ),
            ),
        ),
      ),
  )

const gridOf = ({ bounds, zoom }: PictureFrame) => ({
  step: TILE_SIZE * zoom,
  offsetX:
    (Math.ceil(bounds.left / TILE_SIZE) * TILE_SIZE - bounds.left) * zoom,
  offsetY: (Math.ceil(bounds.top / TILE_SIZE) * TILE_SIZE - bounds.top) * zoom,
})

const hoverBoxOf = (tile: Tile, { bounds, zoom }: PictureFrame) => ({
  x: (tile.column * TILE_SIZE - bounds.left) * zoom,
  y: (tile.row * TILE_SIZE - bounds.top) * zoom,
  size: TILE_SIZE * zoom,
})

const ROOM_POINTER: {
  readonly [Kind in PointerKind]: (tile: Tile) => Message
} = {
  Move: tile => Message.HoveredTile({ tile }),
  Down: tile => Message.PressedRoomTile({ tile }),
  Up: () => Message.ReleasedRoom(),
  Leave: () => Message.LeftRoom(),
}

const roomPointerMessage =
  (frame: PictureFrame) =>
  (pointer: PointerOnPicture): Message =>
    ROOM_POINTER[pointer.kind](tileOfPin(pinAt(frame)(pointer)))

const roomKeyOf = (model: Model): string =>
  `${model.room}|${model.house}|${model.isKitchenOpen}|${model.isTwistOn}|${model.zoom}|${model.backdrop}`

const roomView = (h: StudioH, model: Model): StudioHtml => {
  const { shapes, bounds } = roomFrameOf(model)
  const frame = { bounds, zoom: model.zoom }
  const { width, height } = sizeOf(bounds, model.zoom)
  return h.main.class('middle').children(
    h.p
      .class('gallery-hint')
      .children(
        '👆 Drag over the room to pick tiles for a note, or tap just one.',
      ),
    h.div
      .class('stage-canvases', 'room')
      .style({ width: `${width}px`, height: `${height}px` })
      .children(
        studioPicture(h)
          .class('sprite', 'room-art')
          .picture({
            key: roomKeyOf(model),
            width,
            height,
            shapes: [
              backdropRect({ width, height }, model.backdrop),
              zoomed(shapes, bounds, model.zoom),
            ],
          }),
        marksView(h, {
          width,
          height,
          pins: [],
          areas: areaMarksOf({
            model,
            notes: notesFor(model, roomTargetOf(model.room)),
            frame,
          }),
          maybeGrid: model.isGridOn
            ? Option.some(gridOf(frame))
            : Option.none(),
          maybeHover: Option.map(model.maybeHoverTile, tile =>
            hoverBoxOf(tile, frame),
          ),
          pointer: picturePointer(roomPointerMessage(frame)),
        }),
      ),
  )
}

const liveView = (h: StudioH, model: Model): StudioHtml =>
  h.main.class('middle').children(
    h.p
      .class('gallery-hint')
      .children(
        model.liveTool === 'Loupe'
          ? '🔍 Hover the room to see its pixels up close.'
          : '👆 Drag over the room to pick tiles for a note, or tap just one.',
      ),
    studioWorld(h)
      .key('live-world')
      .class('live-world')
      .query(harnessQueryOf({ scene: model.live, house: model.house }))
      .marks({
        tool: model.liveTool,
        isGridOn: model.isGridOn,
        hover: Option.getOrNull(model.maybeHoverTile),
        draft: Option.getOrNull(model.maybeDraftArea),
        areas: Array.flatMap(notesFor(model, roomTargetOf(model.room)), note =>
          note.area === null
            ? []
            : [{ area: note.area, isDone: note.status === 'Done' }],
        ),
      })
      .tuning(model.labEdits)
      .on('hover-tile', tile => Message.HoveredTile({ tile }))
      .on('press-tile', tile => Message.PressedRoomTile({ tile }))
      .on('release-tile', Message.ReleasedRoom())
      .on('leave-world', Message.LeftRoom()),
    h.div
      .class('toolbar')
      .attr('role', 'toolbar')
      .children(labToggleView(h, model)),
    model.isLabOpen && labView(h, model),
  )

export const titleOf = (model: Model): string =>
  `Munch Studio: ${Option.match(
    Option.flatMap(model.maybeSelectedId, entryById),
    {
      onNone: () => model.tab,
      onSome: entry => entry.title,
    },
  )}`

const drawn = StudioDef.view((h, model) =>
  h.div
    .class('studio')
    .children(
      sidebarView(h, model),
      model.tab === 'Rooms'
        ? model.room === 'Live'
          ? liveView(h, model)
          : roomView(h, model)
        : galleryView(h, model),
      inspectorView(h, model),
    ),
)

type DrawnH = Parameters<typeof drawn>[0]
type Drawn = ReturnType<typeof drawn>

export const view: {
  (model: Model): (h: DrawnH) => Drawn
  (h: DrawnH, model: Model): Drawn
} = Function.dual(2, (h: DrawnH, model: Model): Drawn => drawn(h, model))
