import { Option } from 'effect'
import type { Canvas } from 'foldkit'

import { sparkShapes } from './crewBoardView'
import { rect } from './drawing'
import {
  type EndKind,
  RANK_FILL_MS,
  RANK_POP_MS,
  easeOut,
  easeOutBack,
  isRankedUp,
  progressOf,
  rankStripAtMs,
} from './endBeat'
import { GLYPH_HEIGHT, textShapes, textWidth } from './font'
import type { Model } from './model'
import { badgeTierOf, rankProgressOf, shownPointsOf } from './rank'
import { BONE, BONE_SIZE, badgeSprite } from './rankArt'
import { group, placeAt } from './sprite'

// The rank strip on the end card, in the landscape frame: the badge, the
// rank number, a bar that fills from the points before the run to the points
// after, and the Bones counting up beside a pixel bone. It reads everything
// from the points it is showing, so a bar that fills past the end of a rank
// carries on in the next one, the number ticks, and the badge changes. On a
// rank up the badge pops with sparks once the bar is full. Timing is
// src/endBeat.ts's; the panel behind it is the caller's.

export const STRIP_PX = 11

const BAR_EDGE = '#5a3a4a'
const BAR_BACK = '#140c10'
const BAR_FILL = '#ffd23f'
const BAR_SHINE = '#fff2a8'
const BADGE_X = 5
const NUMBER_X = 13
const BAR_X = 32
const BAR_WIDTH = 70
const BONES_GAP_PX = 4
const BONE_TEXT_GAP_PX = 3
const POP_SCALE = 1.2
const FADE_MS = 120

const barShapes = (
  x: number,
  y: number,
  fraction: number,
): ReadonlyArray<Canvas.Shape> => {
  const filled = Math.round(BAR_WIDTH * fraction)
  return [
    rect(x - 1, y - 3, BAR_WIDTH + 2, 6, BAR_EDGE),
    rect(x, y - 2, BAR_WIDTH, 4, BAR_BACK),
    ...(filled > 0
      ? [
          rect(x, y - 2, filled, 4, BAR_FILL),
          rect(x, y - 2, filled, 1, BAR_SHINE),
        ]
      : []),
  ]
}

// NOTE: `left` and `width` are the strip's room, `centerY` its middle.
export const rankStripShapes = (
  model: Model,
  kind: EndKind,
  ms: number,
  left: number,
  centerY: number,
  width: number,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(model.maybeRankGain, {
    onNone: () => [],
    onSome: ({ pointsBefore, gained, bonesGained }) => {
      const startMs = rankStripAtMs(model, kind)
      if (ms < startMs) {
        return []
      }
      const fillT = easeOut(progressOf(ms, startMs, RANK_FILL_MS))
      const progress = rankProgressOf(
        shownPointsOf(pointsBefore, gained, fillT),
      )
      const popAtMs = startMs + RANK_FILL_MS
      const isPopping = isRankedUp(model) && ms >= popAtMs
      const pop = isPopping
        ? 1 +
          (POP_SCALE - 1) *
            2 *
            (1 - easeOutBack(progressOf(ms, popAtMs, RANK_POP_MS)))
        : 1
      const number = `${progress.rank}`
      const barX = left + BAR_X
      const bones = Math.round(bonesGained * fillT)
      const bonesText = `+${bones}`
      const bonesRight = left + width
      const boneX =
        bonesRight -
        textWidth(bonesText) -
        BONE_TEXT_GAP_PX -
        BONE_SIZE.width / 2
      const fade = easeOut(progressOf(ms, startMs, FADE_MS))
      return [
        group({
          opacity: fade >= 1 ? undefined : fade,
          shapes: [
            group({
              translate: { x: left + BADGE_X, y: centerY },
              scale: pop === 1 ? undefined : { x: pop, y: pop },
              shapes: badgeSprite(badgeTierOf(progress.rank)),
            }),
            ...textShapes(
              number,
              isPopping ? 'Victory' : 'Plain',
              left + NUMBER_X,
              centerY - Math.floor(GLYPH_HEIGHT / 2),
              'Left',
            ),
            ...barShapes(barX, centerY, progress.fraction),
            ...(bonesGained > 0 && barX + BAR_WIDTH + BONES_GAP_PX < boneX
              ? [
                  placeAt(Math.round(boneX), centerY, BONE),
                  ...textShapes(
                    bonesText,
                    'Victory',
                    bonesRight,
                    centerY - Math.floor(GLYPH_HEIGHT / 2),
                    'Right',
                  ),
                ]
              : []),
            ...(isPopping
              ? sparkShapes(left + BADGE_X, centerY, ms - popAtMs)
              : []),
          ],
        }),
      ]
    },
  })
