import { Canvas } from 'foldkit'

import { bakeShapes } from '../art/sprite'

// The small square badge pinned to the window's edge toward someone out of
// sight: a teammate in co-op, in their seat's color
// (src/features/onlineRun/coopMarksView.ts), and the wave's last zombies
// once they hurry, in the rage's red (src/features/hud/stragglerEdge.ts).

export const EDGE_BADGE_PX = 9
export const EDGE_BADGE_INK = '#1a0f14'

export const edgeBadgeOf = (color: string): ReadonlyArray<Canvas.Shape> =>
  bakeShapes([
    Canvas.Rect({
      x: 1,
      y: 0,
      width: EDGE_BADGE_PX - 2,
      height: EDGE_BADGE_PX,
      fill: EDGE_BADGE_INK,
    }),
    Canvas.Rect({
      x: 0,
      y: 1,
      width: EDGE_BADGE_PX,
      height: EDGE_BADGE_PX - 2,
      fill: EDGE_BADGE_INK,
    }),
    Canvas.Rect({
      x: 1,
      y: 1,
      width: EDGE_BADGE_PX - 2,
      height: EDGE_BADGE_PX - 2,
      fill: color,
    }),
    Canvas.Rect({
      x: 3,
      y: 3,
      width: EDGE_BADGE_PX - 6,
      height: EDGE_BADGE_PX - 6,
      fill: EDGE_BADGE_INK,
    }),
  ])
