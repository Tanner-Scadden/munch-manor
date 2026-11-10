// Pins drawn over a picture: each note's spot, numbered as the note list
// numbers it, and the spot of the note being written.
import { Array, Option, pipe } from 'effect'
import { Canvas } from 'foldkit'

import { TILE_SIZE } from '../../src/shared/constants'
import type { Model } from './block'
import type { Bounds } from './catalog'
import type { Pin, StoredNote, TileArea } from './notes'

const OPEN_COLOR = '#ffb020'
const DONE_COLOR = '#3fbf6a'
const DRAFT_COLOR = '#4fa3ff'
const PIN_RADIUS = 11

const pinMark = (
  pin: Pin,
  label: string,
  color: string,
  { bounds, zoom }: PictureFrame,
): ReadonlyArray<Canvas.Shape> => {
  const x = (pin.x + 0.5 - bounds.left) * zoom
  const y = (pin.y + 0.5 - bounds.top) * zoom
  return [
    Canvas.Circle({
      x,
      y: y + 2,
      radius: PIN_RADIUS,
      fill: 'rgba(0, 0, 0, 0.35)',
    }),
    Canvas.Circle({
      x,
      y,
      radius: PIN_RADIUS,
      fill: color,
      stroke: '#ffffff',
      lineWidth: 2,
    }),
    Canvas.Text({
      x,
      y: y + 1,
      content: label,
      font: 'bold 12px ui-sans-serif, system-ui, sans-serif',
      fill: '#14121a',
      align: 'Center',
      baseline: 'Middle',
    }),
  ]
}

// NOTE: a note's number among the notes about one thing, oldest first, the
// same in the list and on its pin.
export const numberedNotes = (
  notes: ReadonlyArray<StoredNote>,
): ReadonlyArray<readonly [number, StoredNote]> =>
  Array.map(notes, (note, index) => [index + 1, note] as const)

// NOTE: how a picture is laid out: the box it shows, at what zoom.
export type PictureFrame = Readonly<{ bounds: Bounds; zoom: number }>

export const pinShapes = (
  input: Readonly<{
    model: Model
    notes: ReadonlyArray<StoredNote>
    frame: PictureFrame
  }>,
): ReadonlyArray<Canvas.Shape> => {
  const { model, notes, frame } = input
  return [
    ...pipe(
      numberedNotes(notes),
      Array.flatMap(([number, note]) =>
        Option.match(Option.fromNullishOr(note.pin), {
          onNone: () => [],
          onSome: pin =>
            pinMark(
              pin,
              `${number}`,
              note.status === 'Done' ? DONE_COLOR : OPEN_COLOR,
              frame,
            ),
        }),
      ),
    ),
    ...Option.match(model.maybeDraftPin, {
      onNone: () => [],
      onSome: pin => pinMark(pin, '+', DRAFT_COLOR, frame),
    }),
  ]
}

// NOTE: where a press on a picture lands, in the picture's own pixels.
export const pinAt =
  ({ bounds, zoom }: PictureFrame) =>
  ({ x, y }: Readonly<{ x: number; y: number }>): Pin => ({
    x: Math.floor(x / zoom + bounds.left),
    y: Math.floor(y / zoom + bounds.top),
  })

// AREAS

const AREA_FILL: Readonly<Record<'Open' | 'Done' | 'Draft', string>> = {
  Open: 'rgba(255, 176, 32, 0.18)',
  Done: 'rgba(63, 191, 106, 0.16)',
  Draft: 'rgba(79, 163, 255, 0.22)',
}

const AREA_LINE: Readonly<Record<'Open' | 'Done' | 'Draft', string>> = {
  Open: OPEN_COLOR,
  Done: DONE_COLOR,
  Draft: DRAFT_COLOR,
}

const areaMark = (
  area: TileArea,
  label: string,
  look: 'Open' | 'Done' | 'Draft',
  frame: PictureFrame,
): ReadonlyArray<Canvas.Shape> => {
  const { bounds, zoom } = frame
  const x = (area.left * TILE_SIZE - bounds.left) * zoom
  const y = (area.top * TILE_SIZE - bounds.top) * zoom
  const width = (area.right - area.left + 1) * TILE_SIZE * zoom
  const height = (area.bottom - area.top + 1) * TILE_SIZE * zoom
  return [
    Canvas.Rect({ x, y, width, height, fill: AREA_FILL[look] }),
    Canvas.Rect({ x, y, width, height, stroke: AREA_LINE[look], lineWidth: 3 }),
    ...pinMark(
      { x: area.left * TILE_SIZE, y: area.top * TILE_SIZE },
      label,
      AREA_LINE[look],
      frame,
    ),
  ]
}

// NOTE: the room's notes as the tiles each picked, numbered as the note list
// numbers them, and the tiles picked for the note being written.
export const areaShapes = (
  input: Readonly<{
    model: Model
    notes: ReadonlyArray<StoredNote>
    frame: PictureFrame
  }>,
): ReadonlyArray<Canvas.Shape> => {
  const { model, notes, frame } = input
  return [
    ...pipe(
      numberedNotes(notes),
      Array.flatMap(([number, note]) =>
        Option.match(Option.fromNullishOr(note.area), {
          onNone: () => [],
          onSome: area =>
            areaMark(
              area,
              `${number}`,
              note.status === 'Done' ? 'Done' : 'Open',
              frame,
            ),
        }),
      ),
    ),
    ...Option.match(model.maybeDraftArea, {
      onNone: () => [],
      onSome: area => areaMark(area, '+', 'Draft', frame),
    }),
  ]
}
