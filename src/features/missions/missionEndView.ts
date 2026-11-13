import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { GLYPH_HEIGHT, textShapes, textWidth } from '../../art/font'
import {
  ALL_THREE_SPRITE,
  MISSION_DONE_SPRITE,
  MISSION_SPRITES,
} from '../../art/missionIcons'
import { BONE, BONE_SIZE } from '../../art/rankArt'
import { group, placeAt } from '../../art/sprite'
import { rect } from '../../render/drawing'
import { ALL_THREE_BONES, bonesOfMission } from '../../shared/missionData'
import { ALL_THREE_TAG } from '../../world/names'
import { clamp, easeOut } from '../../world/step/geometry'
import type { MissionGain, MovedMission } from './missionSchema'

// The daily missions a run moved, on the end card's canvas in the landscape
// frame: a small panel of a row each, its picture, a bar that fills from
// the count before the run to the count after, and, for one the run
// finished, its Bones popping in gold with a check over the picture. The
// day's three done adds the rosette's row and its bonus. The end card's
// clock places it (`startMs`, after the rank strip); the screen picks its
// spot beside or under the card (src/screens/game/endMissions.ts).

const ROW_PX = 12
const PAD_PX = 3
export const MISSION_PANEL_WIDTH = 72
const ICON_X = 8
const BAR_X = 16
const BAR_WIDTH = 24
const BAR_HEIGHT = 4
const BONES_RIGHT = MISSION_PANEL_WIDTH - PAD_PX
const ROW_STAGGER_MS = 240
const FILL_MS = 520
const POP_MS = 260
const POP_SCALE = 1.35
const FADE_MS = 160

const PANEL_EDGE = '#3c7a74'
const PANEL_FILL = 'rgba(14, 20, 24, 0.94)'
const BAR_BACK = '#140c10'
const BAR_FILL = '#5ee0d0'
const BAR_DONE = '#9be36a'

// NOTE: the panel's height for a gain, its rosette row too.
const panelHeightOf = (gain: MissionGain): number =>
  PAD_PX * 2 + (gain.moved.length + (gain.isAllThree ? 1 : 0)) * ROW_PX

const shareOf = (ms: number, startMs: number, spanMs: number): number =>
  clamp((ms - startMs) / spanMs, 0, 1)

const rowAtMs = (startMs: number, index: number): number =>
  startMs + FADE_MS + index * ROW_STAGGER_MS

// NOTE: a gold number over a pixel bone, popping as it lands, right-aligned
// at `right`.
const bonesShapes = (
  bones: number,
  right: number,
  centerY: number,
  pop: number,
): Canvas.Shape => {
  const text = `+${bones}`
  const width = textWidth(text) + 2 + BONE_SIZE.width
  const centerX = right - Math.round(width / 2)
  return group({
    translate: { x: centerX, y: centerY },
    scale: pop === 1 ? undefined : { x: pop, y: pop },
    shapes: [
      ...textShapes(
        text,
        'Victory',
        -Math.round(width / 2),
        -Math.floor(GLYPH_HEIGHT / 2),
        'Left',
      ),
      placeAt(Math.round(width / 2) - Math.ceil(BONE_SIZE.width / 2), 0, BONE),
    ],
  })
}

const popOf = (ms: number, atMs: number): number => {
  const share = shareOf(ms, atMs, POP_MS)
  return share >= 1 ? 1 : 1 + (POP_SCALE - 1) * Math.sin(share * Math.PI)
}

const rowShapes = (
  mission: MovedMission,
  index: number,
  ms: number,
  startMs: number,
  left: number,
  top: number,
): ReadonlyArray<Canvas.Shape> => {
  const atMs = rowAtMs(startMs, index)
  if (ms < atMs) {
    return []
  }
  const centerY = top + PAD_PX + index * ROW_PX + Math.floor(ROW_PX / 2)
  const goal = Math.max(1, mission.goal)
  const fill = easeOut(shareOf(ms, atMs, FILL_MS))
  const shown = mission.from + (mission.to - mission.from) * fill
  const isLanded = ms >= atMs + FILL_MS
  const isDoneShown = mission.isDone && isLanded
  const barWidth = Math.round((BAR_WIDTH * Math.min(goal, shown)) / goal)
  return [
    placeAt(left + ICON_X, centerY, MISSION_SPRITES[mission.mission]),
    ...(isDoneShown
      ? [placeAt(left + ICON_X + 3, centerY + 2, MISSION_DONE_SPRITE)]
      : []),
    rect(
      left + BAR_X - 1,
      centerY - BAR_HEIGHT / 2 - 1,
      BAR_WIDTH + 2,
      BAR_HEIGHT + 2,
      BAR_BACK,
    ),
    ...(barWidth > 0
      ? [
          rect(
            left + BAR_X,
            centerY - BAR_HEIGHT / 2,
            barWidth,
            BAR_HEIGHT,
            isDoneShown ? BAR_DONE : BAR_FILL,
          ),
        ]
      : []),
    ...(isDoneShown
      ? [
          bonesShapes(
            bonesOfMission(mission.mission),
            left + BONES_RIGHT,
            centerY,
            popOf(ms, atMs + FILL_MS),
          ),
        ]
      : [
          ...textShapes(
            `${Math.round(Math.min(goal, shown))}/${mission.goal}`,
            'Plain',
            left + BONES_RIGHT,
            centerY - Math.floor(GLYPH_HEIGHT / 2),
            'Right',
          ),
        ]),
  ]
}

// NOTE: when the rosette's row pops: after every row has landed.
const allThreeAtMs = (startMs: number, rows: number): number =>
  rowAtMs(startMs, rows - 1) + FILL_MS + POP_MS

const allThreeShapes = (
  rows: number,
  ms: number,
  startMs: number,
  left: number,
  top: number,
): ReadonlyArray<Canvas.Shape> => {
  const atMs = allThreeAtMs(startMs, rows)
  if (ms < atMs) {
    return []
  }
  const centerY = top + PAD_PX + rows * ROW_PX + Math.floor(ROW_PX / 2)
  return [
    placeAt(left + ICON_X, centerY, ALL_THREE_SPRITE),
    ...textShapes(
      ALL_THREE_TAG,
      'Victory',
      left + BAR_X,
      centerY - Math.floor(GLYPH_HEIGHT / 2),
      'Left',
    ),
    bonesShapes(ALL_THREE_BONES, left + BONES_RIGHT, centerY, popOf(ms, atMs)),
  ]
}

// NOTE: the spot the screen picks: the panel's center and top.
export type MissionSpot = Readonly<{ x: number; top: number }>

// NOTE: the end card's mission panel from `startMs` on the end clock,
// nothing when the run moved none.
export const missionEndShapes: {
  (
    ms: number,
    startMs: number,
    spot: MissionSpot,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (
    model: Model,
    ms: number,
    startMs: number,
    spot: MissionSpot,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  4,
  (
    model: Model,
    ms: number,
    startMs: number,
    spot: MissionSpot,
  ): ReadonlyArray<Canvas.Shape> =>
    Option.match(model.maybeMissionGain, {
      onNone: () => [],
      onSome: gain => {
        if (ms < startMs || !Array.isReadonlyArrayNonEmpty(gain.moved)) {
          return []
        }
        const left = spot.x - Math.round(MISSION_PANEL_WIDTH / 2)
        const height = panelHeightOf(gain)
        const fade = easeOut(shareOf(ms, startMs, FADE_MS))
        return [
          group({
            opacity: fade >= 1 ? undefined : fade,
            shapes: [
              rect(
                left - 1,
                spot.top - 1,
                MISSION_PANEL_WIDTH + 2,
                height + 2,
                PANEL_EDGE,
              ),
              rect(left, spot.top, MISSION_PANEL_WIDTH, height, PANEL_FILL),
            ],
          }),
          ...Array.flatMap(gain.moved, (mission, index) =>
            rowShapes(mission, index, ms, startMs, left, spot.top),
          ),
          ...(gain.isAllThree
            ? allThreeShapes(gain.moved.length, ms, startMs, left, spot.top)
            : []),
        ]
      },
    }),
)
