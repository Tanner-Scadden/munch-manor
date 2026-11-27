import { Array, Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import {
  endKindOf,
  rankDoneMs,
  unlockGoneMs,
  unlocksOf,
} from '#features/end/endBeat.ts'
import { endCardEdgesOf } from '#features/end/views/endView.ts'
import {
  MISSION_PANEL_WIDTH,
  type MissionSpot,
  missionEndShapes,
} from '#features/missions/missionEndView.ts'
import { type Screen, landscapeFrameOffset } from '#render/camera/screen.ts'
import type * as Draw from '#render/draw.ts'

const GAP_PX = 3
const BEAT_GAP_MS = 160

const spotOf = (
  model: Model,
  screen: Screen,
  isUpright: boolean,
): Option.Option<MissionSpot> =>
  Option.map(endKindOf(model), kind => {
    const card = endCardEdgesOf(model, kind)
    if (isUpright) {
      return {
        x: Math.round((card.left + card.right) / 2),
        top: card.bottom + GAP_PX + 1,
      }
    }
    const visibleRight = -landscapeFrameOffset(screen).x + screen.width
    const half = Math.round(MISSION_PANEL_WIDTH / 2)
    const beside = Math.round((card.right + visibleRight) / 2)
    return {
      x: Math.min(beside, visibleRight - GAP_PX - half - 1),
      top: card.top + 1,
    }
  })

const startMsOf = (model: Model, isUpright: boolean): Option.Option<number> =>
  Option.map(endKindOf(model), kind =>
    isUpright && Array.isReadonlyArrayNonEmpty(unlocksOf(model))
      ? unlockGoneMs(model, kind)
      : rankDoneMs(model, kind) + BEAT_GAP_MS,
  )

export const endMissionShapes: {
  (screen: Screen): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, screen: Screen): ReadonlyArray<Draw.Shape> => {
    const isUpright = screen.layout === 'Portrait'
    return Option.match(
      Option.all([
        spotOf(model, screen, isUpright),
        startMsOf(model, isUpright),
      ]),
      {
        onNone: () => [],
        onSome: ([spot, startMs]) =>
          missionEndShapes(model, model.screenMs, startMs, spot),
      },
    )
  },
)
