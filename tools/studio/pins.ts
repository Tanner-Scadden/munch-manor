// Pins over a picture: each note's spot, numbered as the note list numbers
// it, and the spot of the note being written, as marks in the picture's own
// screen pixels for the view to stand as HTML (./marksView.ts).
import { Array, Option, pipe } from 'effect'

import { TILE_SIZE } from '../../src/shared/constants'
import type { Model } from './block'
import type { Bounds } from './catalog'
import type { Pin, StoredNote, TileArea } from './notes'

const OPEN_COLOR = '#ffb020'
const DONE_COLOR = '#3fbf6a'
const DRAFT_COLOR = '#4fa3ff'

// NOTE: a pin's middle, its label, and its color, in screen pixels.
export type PinMark = Readonly<{
  x: number
  y: number
  label: string
  color: string
}>

const pinMark = (
  pin: Pin,
  label: string,
  color: string,
  { bounds, zoom }: PictureFrame,
): PinMark => ({
  x: (pin.x + 0.5 - bounds.left) * zoom,
  y: (pin.y + 0.5 - bounds.top) * zoom,
  label,
  color,
})

// NOTE: a note's number among the notes about one thing, oldest first, the
// same in the list and on its pin.
export const numberedNotes = (
  notes: ReadonlyArray<StoredNote>,
): ReadonlyArray<readonly [number, StoredNote]> =>
  Array.map(notes, (note, index) => [index + 1, note] as const)

// NOTE: how a picture is laid out: the box it shows, at what zoom.
export type PictureFrame = Readonly<{ bounds: Bounds; zoom: number }>

export const pinMarksOf = (
  input: Readonly<{
    model: Model
    notes: ReadonlyArray<StoredNote>
    frame: PictureFrame
  }>,
): ReadonlyArray<PinMark> => {
  const { model, notes, frame } = input
  return [
    ...pipe(
      numberedNotes(notes),
      Array.flatMap(([number, note]) =>
        Option.match(Option.fromNullishOr(note.pin), {
          onNone: () => [],
          onSome: pin => [
            pinMark(
              pin,
              `${number}`,
              note.status === 'Done' ? DONE_COLOR : OPEN_COLOR,
              frame,
            ),
          ],
        }),
      ),
    ),
    ...Option.match(model.maybeDraftPin, {
      onNone: () => [],
      onSome: pin => [pinMark(pin, '+', DRAFT_COLOR, frame)],
    }),
  ]
}

// NOTE: the same pins as marks for the 3D stage (./stage3d.ts), which
// draws them where each pixel's blocks stand.
export const stagePinsOf = ({
  model,
  notes,
}: Readonly<{
  model: Model
  notes: ReadonlyArray<StoredNote>
}>): ReadonlyArray<Readonly<{ pin: Pin; label: string; color: string }>> => [
  ...pipe(
    numberedNotes(notes),
    Array.flatMap(([number, note]) =>
      Option.match(Option.fromNullishOr(note.pin), {
        onNone: () => [],
        onSome: pin => [
          {
            pin,
            label: `${number}`,
            color: note.status === 'Done' ? DONE_COLOR : OPEN_COLOR,
          },
        ],
      }),
    ),
  ),
  ...Option.match(model.maybeDraftPin, {
    onNone: () => [],
    onSome: pin => [{ pin, label: '+', color: DRAFT_COLOR }],
  }),
]

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

// NOTE: an area's box in screen pixels, its colors, and its pin at the top
// left.
export type AreaMark = Readonly<{
  x: number
  y: number
  width: number
  height: number
  fill: string
  line: string
  pin: PinMark
}>

const areaMark = (
  area: TileArea,
  label: string,
  look: 'Open' | 'Done' | 'Draft',
  frame: PictureFrame,
): AreaMark => {
  const { bounds, zoom } = frame
  return {
    x: (area.left * TILE_SIZE - bounds.left) * zoom,
    y: (area.top * TILE_SIZE - bounds.top) * zoom,
    width: (area.right - area.left + 1) * TILE_SIZE * zoom,
    height: (area.bottom - area.top + 1) * TILE_SIZE * zoom,
    fill: AREA_FILL[look],
    line: AREA_LINE[look],
    pin: pinMark(
      { x: area.left * TILE_SIZE, y: area.top * TILE_SIZE },
      label,
      AREA_LINE[look],
      frame,
    ),
  }
}

// NOTE: the room's notes as the tiles each picked, numbered as the note list
// numbers them, and the tiles picked for the note being written.
export const areaMarksOf = (
  input: Readonly<{
    model: Model
    notes: ReadonlyArray<StoredNote>
    frame: PictureFrame
  }>,
): ReadonlyArray<AreaMark> => {
  const { model, notes, frame } = input
  return [
    ...pipe(
      numberedNotes(notes),
      Array.flatMap(([number, note]) =>
        Option.match(Option.fromNullishOr(note.area), {
          onNone: () => [],
          onSome: area => [
            areaMark(
              area,
              `${number}`,
              note.status === 'Done' ? 'Done' : 'Open',
              frame,
            ),
          ],
        }),
      ),
    ),
    ...Option.match(model.maybeDraftArea, {
      onNone: () => [],
      onSome: area => [areaMark(area, '+', 'Draft', frame)],
    }),
  ]
}
