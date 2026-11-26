import { Array, Function, Option } from 'effect'

import type { Model } from '#app/model.ts'
import { DARE_ICONS, DARE_ICON_SIZE } from '#art/dareArt.ts'
import { textShapes, textWidth } from '#art/font.ts'
import { group, placeAt } from '#art/sprite.ts'
import { runDifficultyOf } from '#domain/onlineRun.ts'
import type * as Draw from '#render/draw.ts'
import { isBetterRun } from '#shared/playerData.ts'
import { isCoop } from '#world/party/party.ts'
import { type BestRun, Phase, RunMode } from '#world/schema/worldSchema.ts'

import { bestRunOf } from './endBeat.ts'

const GHOST_OPACITY = 0.55
const ICON_STRIDE = DARE_ICON_SIZE + 1
const TEXT_GAP = 3

export const maybeGhostOf = (model: Model): Option.Option<BestRun> =>
  !isCoop(model) &&
  Phase.isAnyOf(['GameOver'])(model.phase) &&
  RunMode.isAnyOf(['Campaign'])(model.mode)
    ? Option.filter(
        model.bests.byDifficulty[runDifficultyOf(model)].maybeBestRun,
        best => isBetterRun(best, bestRunOf(model)),
      )
    : Option.none()

export const ghostShapes: {
  (centerX: number, y: number): (best: BestRun) => Draw.Shape
  (best: BestRun, centerX: number, y: number): Draw.Shape
} = Function.dual(
  3,
  (best: BestRun, centerX: number, y: number): Draw.Shape => {
    const label = `BEST ${best.wave}`
    const iconsWidth = best.things.length * ICON_STRIDE
    const width =
      textWidth(label) + (iconsWidth > 0 ? TEXT_GAP + iconsWidth - 1 : 0)
    const left = Math.round(centerX - width / 2)
    const iconsLeft = left + textWidth(label) + TEXT_GAP
    return group({
      opacity: GHOST_OPACITY,
      shapes: [
        ...textShapes(label, 'Hint', left, y, 'Left'),
        ...Array.map(best.things, (thing, index) =>
          placeAt(iconsLeft + index * ICON_STRIDE, y - 1, DARE_ICONS[thing]),
        ),
      ],
    })
  },
)
