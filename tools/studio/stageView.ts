// The big view of the picked sprite: it plays large, steps frame by frame,
// shows the frame before as a ghost, stands beside the crew for scale, and
// takes a tap as a pin for a note.
import { Array, Function } from 'effect'
import { Canvas } from 'foldkit'
import type { Html } from 'foldkit/html'

import { group } from '../../src/art/sprite'
import {
  Message,
  type Model,
  SPEEDS,
  type StudioViewBuilder,
  freshDoneOf,
  notesFor,
} from './block'
import { type Bounds, type Entry, crewOf } from './catalog'
import {
  backdropRect,
  frameIndexOf,
  frameOf,
  lookOf,
  padded,
  paddedBy,
  sizeOf,
  spritesBounds,
  zoomed,
} from './drawing'
import { pinAt, pinShapes } from './pins'

// NOTE: the big view aims for a picture about this tall, in screen pixels.
const STAGE_HEIGHT = 260
const MIN_STAGE_ZOOM = 3
const MAX_STAGE_ZOOM = 16
const CREW_GAP = 6
const ONION_OPACITY = 0.3
const STAGE_PAD = 4

const joinBounds = (a: Bounds, b: Bounds): Bounds => ({
  left: Math.min(a.left, b.left),
  top: Math.min(a.top, b.top),
  right: Math.max(a.right, b.right),
  bottom: Math.max(a.bottom, b.bottom),
})

type Placed = Readonly<{ shapes: ReadonlyArray<Canvas.Shape>; bounds: Bounds }>

// NOTE: the crew stand to the left of the sprite, feet on the same line,
// each a little apart.
const crewPlaced = (
  model: Model,
  index: number,
  subject: Bounds,
): ReadonlyArray<Placed> =>
  Array.reduce(
    crewOf(lookOf(model), index),
    { rightEdge: subject.left - CREW_GAP, placed: Array.empty<Placed>() },
    (state, sprite) => {
      const own = spritesBounds([sprite])
      const shift = state.rightEdge - own.right
      return {
        rightEdge: own.left + shift - CREW_GAP,
        placed: Array.append(state.placed, {
          shapes: [group({ translate: { x: shift, y: 0 }, shapes: sprite })],
          bounds: {
            left: own.left + shift,
            top: own.top,
            right: own.right + shift,
            bottom: own.bottom,
          },
        }),
      }
    },
  ).placed

const toolButton = (
  content: string,
  title: string,
  message: Message,
  h: StudioViewBuilder,
  className: string = 'tool',
): Html =>
  h.button(
    [
      h.Class(className),
      h.Title(title),
      h.AriaLabel(title),
      h.OnClick(message),
    ],
    [content],
  )

const toggle = (
  label: string,
  title: string,
  isOn: boolean,
  message: Message,
  h: StudioViewBuilder,
): Html =>
  h.button(
    [
      h.Class(isOn ? 'tool-toggle on' : 'tool-toggle'),
      h.AriaPressed(isOn ? 'true' : 'false'),
      h.Title(title),
      h.OnClick(message),
    ],
    [label],
  )

const divider = (h: StudioViewBuilder): Html =>
  h.span([h.Class('tool-divider'), h.AriaHidden(true)])

const toolbarView = (
  model: Model,
  index: number,
  count: number,
  h: StudioViewBuilder,
): Html =>
  h.div(
    [h.Class('toolbar'), h.Role('toolbar')],
    [
      toolButton('‹', 'Frame before', Message.ClickedStep({ step: -1 }), h),
      toolButton(
        model.isPlaying ? '❚❚' : '▶',
        model.isPlaying ? 'Pause' : 'Play',
        Message.ClickedPlay(),
        h,
        'tool play',
      ),
      toolButton('›', 'Frame after', Message.ClickedStep({ step: 1 }), h),
      h.span([h.Class('frame-count')], [`${index + 1} / ${count}`]),
      divider(h),
      h.div(
        [h.Class('segmented small'), h.Role('group'), h.Title('Speed')],
        Array.map(SPEEDS, speed =>
          h.button(
            [
              h.Class(model.speed === speed ? 'segment on' : 'segment'),
              h.AriaPressed(model.speed === speed ? 'true' : 'false'),
              h.Title(`Play at ${speed} speed`),
              h.OnClick(Message.ClickedSpeed({ speed })),
            ],
            [speed === 0.5 ? '½×' : `${speed}×`],
          ),
        ),
      ),
      divider(h),
      toggle(
        'Ghost frame',
        'Show the frame before, faded, under this one',
        model.isOnion,
        Message.ClickedOnion(),
        h,
      ),
      toggle(
        'With the crew',
        'Stand it beside the player and a Groaner to check its size',
        model.isCrew,
        Message.ClickedCrew(),
        h,
      ),
    ],
  )

// NOTE: Foldkit's views pass the builder last, as the game's do.
export const stageView: {
  (entry: Entry, h: StudioViewBuilder): (model: Model) => Html
  (model: Model, entry: Entry, h: StudioViewBuilder): Html
} = Function.dual(
  3,
  (model: Model, entry: Entry, h: StudioViewBuilder): Html => {
    const frames = entry.frames(lookOf(model))
    const count = frames.length
    const index = frameIndexOf(entry, model.clockMs, count)
    const subject = padded(spritesBounds(frames))
    const crew = model.isCrew ? crewPlaced(model, index, subject) : []
    const bounds = paddedBy(STAGE_PAD)(
      Array.reduce(crew, subject, (all, placed) =>
        joinBounds(all, placed.bounds),
      ),
    )
    const zoom = Math.max(
      MIN_STAGE_ZOOM,
      Math.min(
        MAX_STAGE_ZOOM,
        Math.floor(STAGE_HEIGHT / Math.max(1, bounds.bottom - bounds.top)),
      ),
    )
    const { width, height } = sizeOf(bounds, zoom)
    const ghost =
      model.isOnion && count > 1
        ? [
            group({
              opacity: ONION_OPACITY,
              shapes: frameOf(frames, (index + count - 1) % count),
            }),
          ]
        : []
    const isFresh = Array.isReadonlyArrayNonEmpty(freshDoneOf(model, entry.id))
    return h.section(
      [h.Class('stage')],
      [
        h.div(
          [h.Class('stage-head')],
          [
            h.h2([], [entry.title]),
            ...(isFresh
              ? [h.span([h.Class('updated-chip')], ['Updated'])]
              : []),
            h.span([h.Class('stage-hint')], ['Tap the picture to pin a note']),
          ],
        ),
        h.div(
          [h.Class('stage-surface')],
          [
            h.div(
              [
                h.Class('stage-canvases'),
                h.Style({ width: `${width}px`, height: `${height}px` }),
              ],
              [
                Canvas.view(
                  {
                    key: 'stage-art',
                    width,
                    height,
                    shapes: [
                      backdropRect({ width, height }, model.backdrop),
                      zoomed(
                        [
                          ...ghost,
                          ...Array.flatMap(crew, placed => placed.shapes),
                          ...frameOf(frames, index),
                        ],
                        bounds,
                        zoom,
                      ),
                    ],
                    className: 'sprite stage-art',
                  },
                  h,
                ),
                Canvas.view(
                  {
                    key: 'stage-pins',
                    width,
                    height,
                    shapes: pinShapes({
                      model,
                      notes: notesFor(model, entry.id),
                      frame: { bounds, zoom },
                    }),
                    className: 'pins',
                    onPointerDown: ({ x, y }) =>
                      Message.PressedPicture({
                        pin: pinAt({ bounds, zoom })({ x, y }),
                      }),
                  },
                  h,
                ),
              ],
            ),
          ],
        ),
        toolbarView(model, index, count, h),
      ],
    )
  },
)
