import { Array, Function } from 'effect'
import type { Canvas } from 'foldkit'

import { DARE_ICONS, DARE_ICON_SIZE } from '../../art/dareArt'
import { textShapes, textWidth } from '../../art/font'
import { group, placeAt } from '../../art/sprite'
import type { DareOutcome } from '../../domain/beatLink'
import type { BeatComparison, BeatVerdict } from './beatRun'

// A friend's dare on its end card (src/features/end/beatRun.ts): the
// verdict over the tally in the quip's place, BEAT IT! or NOT YET with its
// line, and the friend's result on the wave's row, where the best run's
// ghost would sit: PAL, how it ended, the wave, and the things they found.

const ICON_STRIDE = DARE_ICON_SIZE + 1
const TEXT_GAP = 3

const VERDICT_WORDS: Readonly<Record<BeatVerdict, string>> = {
  BeatIt: 'BEAT IT!',
  NotYet: 'NOT YET',
}

const OUTCOME_SHORT: Readonly<Record<DareOutcome, string>> = {
  Won: 'OUT',
  Chicken: 'RAN',
  Munched: 'MUNCHED',
}

// NOTE: the verdict and its line, centered on `centerX` at `y`, the
// verdict loud and the line as the quip would be.
export const beatVerdictShapes: {
  (centerX: number, y: number): (comparison: BeatComparison) => ReadonlyArray<Canvas.Shape>
  (comparison: BeatComparison, centerX: number, y: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    { verdict, line }: BeatComparison,
    centerX: number,
    y: number,
  ): ReadonlyArray<Canvas.Shape> => {
    const word = VERDICT_WORDS[verdict]
    const gap = line === '' ? 0 : TEXT_GAP + 1
    const width = textWidth(word) + gap + textWidth(line)
    const left = Math.round(centerX - width / 2)
    return [
      ...textShapes(
        word,
        verdict === 'BeatIt' ? 'Victory' : 'Defeat',
        left,
        y,
        'Left',
      ),
      ...textShapes(line, 'Prompt', left + textWidth(word) + gap, y, 'Left'),
    ]
  },
)

// NOTE: the friend's result centered on `centerX` at the text's top `y`.
export const friendRowShapes: {
  (centerX: number, y: number): (comparison: BeatComparison) => Canvas.Shape
  (comparison: BeatComparison, centerX: number, y: number): Canvas.Shape
} = Function.dual(
  3,
  ({ friend }: BeatComparison, centerX: number, y: number): Canvas.Shape => {
    const label = `PAL ${OUTCOME_SHORT[friend.outcome]} ${friend.wave}`
    const iconsWidth = friend.found.length * ICON_STRIDE
    const width =
      textWidth(label) + (iconsWidth > 0 ? TEXT_GAP + iconsWidth - 1 : 0)
    const left = Math.round(centerX - width / 2)
    const iconsLeft = left + textWidth(label) + TEXT_GAP
    return group({
      shapes: [
        ...textShapes(label, 'Fresh', left, y, 'Left'),
        ...Array.map(friend.found, (thing, index) =>
          placeAt(iconsLeft + index * ICON_STRIDE, y - 1, DARE_ICONS[thing]),
        ),
      ],
    })
  },
)
