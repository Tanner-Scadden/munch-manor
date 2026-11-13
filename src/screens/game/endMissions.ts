import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import {
  endKindOf,
  rankDoneMs,
  unlockGoneMs,
  unlocksOf,
} from '../../features/end/endBeat'
import { endCardEdgesOf } from '../../features/end/endView'
import {
  MISSION_PANEL_WIDTH,
  type MissionSpot,
  missionEndShapes,
} from '../../features/missions/missionEndView'
import { type Screen, landscapeFrameOffset } from '../../render/screen'

// The day's missions on the end card (src/features/missions/missionEndView.ts),
// placed by the screen: beside the card at its right on a screen held on its
// side, where the unlock card takes the left, and under it upright, once
// any unlock card there has gone.

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

// NOTE: after the rank strip's beat; upright, after an unlock card under
// the card has gone too, as the two share that spot.
const startMsOf = (model: Model, isUpright: boolean): Option.Option<number> =>
  Option.map(endKindOf(model), kind =>
    isUpright && Array.isReadonlyArrayNonEmpty(unlocksOf(model))
      ? unlockGoneMs(model, kind)
      : rankDoneMs(model, kind) + BEAT_GAP_MS,
  )

export const endMissionShapes: {
  (screen: Screen): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, screen: Screen): ReadonlyArray<Canvas.Shape> => {
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
