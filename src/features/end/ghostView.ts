import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { DARE_ICONS, DARE_ICON_SIZE } from '../../art/dareArt'
import { textShapes, textWidth } from '../../art/font'
import { group, placeAt } from '../../art/sprite'
import { runDifficultyOf } from '../../domain/onlineRun'
import { isBetterRun } from '../../shared/playerData'
import { isCoop } from '../../world/party/party'
import { type BestRun, Phase, RunMode } from '../../world/schema/worldSchema'
import { bestRunOf } from './endBeat'

// The best run's ghost on a lost run's end card: a faint BEST and its wave,
// then the things it found as pictures, on the wave's row of the tally, so
// a player sees how far the best one got. Only a lone player's campaign
// loss shows one, and only while the best is better than this run (a run
// that just became the best has nothing to chase).

const GHOST_OPACITY = 0.55
const ICON_STRIDE = DARE_ICON_SIZE + 1
const TEXT_GAP = 3

// NOTE: the best run to show, read off the bests after the run's records.
export const maybeGhostOf = (model: Model): Option.Option<BestRun> =>
  !isCoop(model) &&
  Phase.isAnyOf(['GameOver'])(model.phase) &&
  RunMode.isAnyOf(['Campaign'])(model.mode)
    ? Option.filter(
        model.bests.byDifficulty[runDifficultyOf(model)].maybeBestRun,
        best => isBetterRun(best, bestRunOf(model)),
      )
    : Option.none()

// NOTE: the ghost centered on `centerX` at the text's top `y`.
export const ghostShapes: {
  (centerX: number, y: number): (best: BestRun) => Canvas.Shape
  (best: BestRun, centerX: number, y: number): Canvas.Shape
} = Function.dual(
  3,
  (best: BestRun, centerX: number, y: number): Canvas.Shape => {
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
