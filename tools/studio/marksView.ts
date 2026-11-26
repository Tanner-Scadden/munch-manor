// The marks over a flat picture as HTML: the notes' pins and areas, the tile
// grid, the hovered tile, and the pointer on it. A Mount reads the pointer,
// since an element's own `pointerdown` payload carries no place on the
// element, and there is no `pointermove` or `pointerup` handler.
import { Array, Function, Option, Schema, Stream } from 'effect'

import { type Component, Mount } from '@effect/ui'

import type { Message, StudioH, StudioHtml } from './block'
import type { AreaMark, PinMark } from './pins'

// THE POINTER

export const PointerKind = Schema.Literals(['Move', 'Down', 'Up', 'Leave'])
export type PointerKind = typeof PointerKind.Type

// NOTE: what the pointer did on the layer, in its own screen pixels.
export type PointerOnPicture = Readonly<{
  kind: PointerKind
  x: number
  y: number
}>

const PRIMARY_MOUSE_BUTTON = 0

const placeOn = (
  element: Element,
  kind: PointerKind,
  event: PointerEvent,
): PointerOnPicture => {
  const { left, top } = element.getBoundingClientRect()
  return { kind, x: event.clientX - left, y: event.clientY - top }
}

const pointerEvents = (
  element: Element,
  name: string,
  kind: PointerKind,
): Stream.Stream<PointerOnPicture> =>
  Stream.fromEventListener<PointerEvent>(element, name).pipe(
    Stream.map(event => placeOn(element, kind, event)),
  )

// NOTE: the pointer over a picture's marks: moving, pressed (a mouse by its
// primary button alone), let go, gone. A let go ends a drag, never a tap's
// act: the tap acted on its press.
const WatchPicturePointer = Mount.makeStream(
  'WatchPicturePointer',
  { args: {} },
  (element: Element) =>
    Stream.mergeAll(
      [
        pointerEvents(element, 'pointermove', 'Move'),
        Stream.fromEventListener<PointerEvent>(element, 'pointerdown').pipe(
          Stream.filter(
            event =>
              event.pointerType !== 'mouse' ||
              event.button === PRIMARY_MOUSE_BUTTON,
          ),
          Stream.map(event => placeOn(element, 'Down', event)),
        ),
        pointerEvents(element, 'pointerup', 'Up'),
        pointerEvents(element, 'pointerleave', 'Leave'),
      ],
      { concurrency: 'unbounded' },
    ),
)

// NOTE: the pointer Mount with what each move means to the studio, read off
// the render it was placed in.
export type PictureMount = Mount.Issued<
  Message | Component.Noop,
  never,
  Element,
  never
>

export const picturePointer = (
  toMessage: (pointer: PointerOnPicture) => Message | Component.Noop,
): PictureMount => WatchPicturePointer().pipe(Mount.map(toMessage))

// THE MARKS

// NOTE: the tile grid as two repeating lines, its first lines `offset` in.
type GridLines = Readonly<{
  step: number
  offsetX: number
  offsetY: number
}>

// NOTE: the hovered tile's box, in screen pixels.
type HoverBox = Readonly<{
  x: number
  y: number
  size: number
}>

const GRID_COLOR = 'rgba(255, 255, 255, 0.14)'

const px = (value: number): string => `${value}px`

const pinView = (h: StudioH, pin: PinMark): StudioHtml =>
  h.span
    .class('pin')
    .attr('aria-hidden', 'true')
    .style({ left: px(pin.x), top: px(pin.y), background: pin.color })
    .children(pin.label)

const areaView = (h: StudioH, area: AreaMark): StudioHtml =>
  h.span
    .class('area')
    .attr('aria-hidden', 'true')
    .style({
      left: px(area.x),
      top: px(area.y),
      width: px(area.width),
      height: px(area.height),
      background: area.fill,
      borderColor: area.line,
    })

const gridStyle = (grid: GridLines) => ({
  backgroundImage: `linear-gradient(to right, ${GRID_COLOR} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_COLOR} 1px, transparent 1px)`,
  backgroundSize: `${px(grid.step)} ${px(grid.step)}`,
  backgroundPosition: `${px(grid.offsetX)} ${px(grid.offsetY)}`,
})

export type MarksInput = Readonly<{
  width: number
  height: number
  pins: ReadonlyArray<PinMark>
  areas: ReadonlyArray<AreaMark>
  maybeGrid: Option.Option<GridLines>
  maybeHover: Option.Option<HoverBox>
  pointer: PictureMount
}>

// NOTE: the layer over a picture, its own size, taking the pointer.
export const marksView: {
  (input: MarksInput): (h: StudioH) => StudioHtml
  (h: StudioH, input: MarksInput): StudioHtml
} = Function.dual(2, (h: StudioH, input: MarksInput): StudioHtml =>
  h.div
    .class('pins')
    .style({
      width: px(input.width),
      height: px(input.height),
      ...Option.match(input.maybeGrid, {
        onNone: () => ({}),
        onSome: gridStyle,
      }),
    })
    .onMount(input.pointer)
    .children(
      ...Array.map(input.areas, area => areaView(h, area)),
      ...Array.map(
        [...input.pins, ...Array.map(input.areas, area => area.pin)],
        pin => pinView(h, pin),
      ),
      ...Option.match(input.maybeHover, {
        onNone: () => [],
        onSome: box => [
          h.span
            .class('hover-tile')
            .attr('aria-hidden', 'true')
            .style({
              left: px(box.x),
              top: px(box.y),
              width: px(box.size),
              height: px(box.size),
            }),
        ],
      }),
    ),
)
