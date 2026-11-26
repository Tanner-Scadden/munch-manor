import { bakeShapes } from '#art/sprite.ts'

import * as Draw from './draw.ts'

export const EDGE_BADGE_PX = 9
export const EDGE_BADGE_INK = '#1a0f14'

export const edgeBadgeOf = (color: string): ReadonlyArray<Draw.Shape> =>
  bakeShapes([
    Draw.Rect({
      x: 1,
      y: 0,
      width: EDGE_BADGE_PX - 2,
      height: EDGE_BADGE_PX,
      fill: EDGE_BADGE_INK,
    }),
    Draw.Rect({
      x: 0,
      y: 1,
      width: EDGE_BADGE_PX,
      height: EDGE_BADGE_PX - 2,
      fill: EDGE_BADGE_INK,
    }),
    Draw.Rect({
      x: 1,
      y: 1,
      width: EDGE_BADGE_PX - 2,
      height: EDGE_BADGE_PX - 2,
      fill: color,
    }),
    Draw.Rect({
      x: 3,
      y: 3,
      width: EDGE_BADGE_PX - 6,
      height: EDGE_BADGE_PX - 6,
      fill: EDGE_BADGE_INK,
    }),
  ])
