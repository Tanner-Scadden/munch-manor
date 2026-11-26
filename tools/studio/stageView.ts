import { Array, Function, Option } from 'effect'

import { Component } from '@effect/ui'

import { group } from '../../src/art/sprite'
import type * as Draw from '../../src/render/draw'
import {
  Message,
  type Model,
  SPEEDS,
  StageMode,
  type StudioH,
  type StudioHtml,
  freshDoneOf,
  notesFor,
} from './block'
import { type Bounds, type Entry, type Tab, crewOf } from './catalog'
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
import { labToggleView, labView } from './labView'
import { marksView, picturePointer } from './marksView'
import { studioPicture } from './picture'
import { pinAt, pinMarksOf, stagePinsOf } from './pins'
import { studioStage } from './stage3d'
import { PRESET_LABELS, StagePreset } from './stagePresets'

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

type Placed = Readonly<{ shapes: ReadonlyArray<Draw.Shape>; bounds: Bounds }>

const crewPlaced = (
  model: Model,
  index: number,
  subject: Bounds,
): ReadonlyArray<Placed> => {
  const placed: Array<Placed> = []
  let rightEdge = subject.left - CREW_GAP
  for (const sprite of crewOf(lookOf(model), index)) {
    const own = spritesBounds([sprite])
    const shift = rightEdge - own.right
    rightEdge = own.left + shift - CREW_GAP
    placed.push({
      shapes: [group({ translate: { x: shift, y: 0 }, shapes: sprite })],
      bounds: {
        left: own.left + shift,
        top: own.top,
        right: own.right + shift,
        bottom: own.bottom,
      },
    })
  }
  return placed
}

const toolButton = (
  h: StudioH,
  content: string,
  title: string,
  message: Message,
  className: string = 'tool',
): StudioHtml =>
  h.button
    .class(className)
    .attr('title', title)
    .attr('aria-label', title)
    .on('click', message)
    .children(content)

const toggle = (
  h: StudioH,
  label: string,
  title: string,
  isOn: boolean,
  message: Message,
): StudioHtml =>
  h.button
    .class(isOn ? 'tool-toggle on' : 'tool-toggle')
    .attr('aria-pressed', isOn ? 'true' : 'false')
    .attr('title', title)
    .on('click', message)
    .children(label)

const divider = (h: StudioH): StudioHtml =>
  h.span.class('tool-divider').attr('aria-hidden', 'true')

const MOST_BY_TAB: Readonly<Record<Tab, number>> = {
  Zombies: 16,
  Heroes: 16,
  Looks: 16,
  Rattles: 16,
  Items: 8,
  Rooms: 6,
}

const segmentedOf = <A extends string>(
  h: StudioH,
  input: Readonly<{
    title: string
    choices: ReadonlyArray<A>
    picked: A
    labelOf: (choice: A) => string
    messageOf: (choice: A) => Message
  }>,
): StudioHtml =>
  h.div
    .class('segmented small')
    .attr('role', 'group')
    .attr('title', input.title)
    .children(
      Array.map(input.choices, choice =>
        h.button
          .class(input.picked === choice ? 'segment on' : 'segment')
          .attr('aria-pressed', input.picked === choice ? 'true' : 'false')
          .on('click', input.messageOf(choice))
          .children(input.labelOf(choice)),
      ),
    )

const MODE_LABELS: Readonly<Record<StageMode, string>> = {
  Flat: '🖼️ Flat',
  Blocks: '🧊 Blocks',
}

const stageBarView = (h: StudioH, model: Model): StudioHtml =>
  h.div
    .class('toolbar')
    .attr('role', 'toolbar')
    .children(
      segmentedOf(h, {
        title: 'See it flat or carved into blocks in 3D',
        choices: StageMode.literals,
        picked: model.stageMode,
        labelOf: mode => MODE_LABELS[mode],
        messageOf: mode => Message.ClickedStageMode({ mode }),
      }),
      ...(model.stageMode === 'Blocks'
        ? [
            divider(h),
            segmentedOf(h, {
              title: 'The light it stands in',
              choices: StagePreset.literals,
              picked: model.stagePreset,
              labelOf: preset => PRESET_LABELS[preset],
              messageOf: preset => Message.ClickedStagePreset({ preset }),
            }),
            divider(h),
            toggle(
              h,
              '🔄 Spin',
              'Turn it round and round (or drag it)',
              model.isAutoSpin,
              Message.ClickedAutoSpin(),
            ),
            toolButton(
              h,
              '🎮 Game camera',
              "Look from the game's own camera, 49° down",
              Message.ClickedPlayCamera(),
              'tool-toggle',
            ),
            labToggleView(h, model),
          ]
        : []),
    )

const blocksView = (h: StudioH, model: Model, entry: Entry): StudioHtml =>
  studioStage(h)
    .key('studio-stage')
    .class('stage3d')
    .subject({
      id: entry.id,
      facing: model.facing,
      tone: model.tone,
      clockMs: model.clockMs,
      most: MOST_BY_TAB[model.tab],
    })
    .preset(model.stagePreset)
    .house(model.house)
    .isAutoSpin(model.isAutoSpin)
    .cameraResets(model.cameraResets)
    .tuning(model.labEdits)
    .pins(stagePinsOf({ model, notes: notesFor(model, entry.id) }))
    .on('press-block', pin => Message.PressedPicture({ pin }))

const toolbarView = (
  h: StudioH,
  model: Model,
  index: number,
  count: number,
): StudioHtml =>
  h.div
    .class('toolbar')
    .attr('role', 'toolbar')
    .children(
      toolButton(h, '‹', 'Frame before', Message.ClickedStep({ step: -1 })),
      toolButton(
        h,
        model.isPlaying ? '❚❚' : '▶',
        model.isPlaying ? 'Pause' : 'Play',
        Message.ClickedPlay(),
        'tool play',
      ),
      toolButton(h, '›', 'Frame after', Message.ClickedStep({ step: 1 })),
      h.span.class('frame-count').children(`${index + 1} / ${count}`),
      divider(h),
      h.div
        .class('segmented small')
        .attr('role', 'group')
        .attr('title', 'Speed')
        .children(
          Array.map(SPEEDS, speed =>
            h.button
              .class(model.speed === speed ? 'segment on' : 'segment')
              .attr('aria-pressed', model.speed === speed ? 'true' : 'false')
              .attr('title', `Play at ${speed} speed`)
              .on('click', Message.ClickedSpeed({ speed }))
              .children(speed === 0.5 ? '½×' : `${speed}×`),
          ),
        ),
      divider(h),
      toggle(
        h,
        'Ghost frame',
        'Show the frame before, faded, under this one',
        model.isOnion,
        Message.ClickedOnion(),
      ),
      toggle(
        h,
        'With the crew',
        'Stand it beside the player and a Groaner to check its size',
        model.isCrew,
        Message.ClickedCrew(),
      ),
    )

const stageKeyOf = (model: Model, entry: Entry, index: number, zoom: number) =>
  `${entry.id}|${index}|${entry.isClockDriven === true ? model.clockMs : 0}|${model.facing}|${model.tone}|${model.isOnion}|${model.isCrew}|${zoom}|${model.backdrop}`

export const stageView: {
  (model: Model, entry: Entry): (h: StudioH) => StudioHtml
  (h: StudioH, model: Model, entry: Entry): StudioHtml
} = Function.dual(3, (h: StudioH, model: Model, entry: Entry): StudioHtml => {
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
  const frame = { bounds, zoom }
  const isFresh = Array.isReadonlyArrayNonEmpty(freshDoneOf(model, entry.id))
  return h.section.class('stage').children(
    h.div
      .class('stage-head')
      .children(
        h.h2.children(entry.title),
        isFresh && h.span.class('updated-chip').children('Updated'),
        h.span
          .class('stage-hint')
          .children(
            model.stageMode === 'Blocks'
              ? 'Drag to turn it, tap a block to pin a note'
              : 'Tap the picture to pin a note',
          ),
      ),
    stageBarView(h, model),
    h.div.class('stage-surface').children(
      model.stageMode === 'Blocks'
        ? blocksView(h, model, entry)
        : h.div
            .class('stage-canvases')
            .style({ width: `${width}px`, height: `${height}px` })
            .children(
              studioPicture(h)
                .class('sprite', 'stage-art')
                .picture({
                  key: stageKeyOf(model, entry, index, zoom),
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
                }),
              marksView(h, {
                width,
                height,
                pins: pinMarksOf({
                  model,
                  notes: notesFor(model, entry.id),
                  frame,
                }),
                areas: [],
                maybeGrid: Option.none(),
                maybeHover: Option.none(),
                pointer: picturePointer(pointer =>
                  pointer.kind === 'Down'
                    ? Message.PressedPicture({ pin: pinAt(frame)(pointer) })
                    : Component.noop,
                ),
              }),
            ),
    ),
    toolbarView(h, model, index, count),
    model.stageMode === 'Blocks' && model.isLabOpen && labView(h, model),
  )
})
