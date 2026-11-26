import { Array, Function } from 'effect'

import { DARE_ICONS, DARE_ICON_SIZE } from '#art/dareArt.ts'
import { textShapes, textWidth } from '#art/font.ts'
import { group, placeAt } from '#art/sprite.ts'
import type { DareOutcome } from '#domain/beatLink.ts'
import type * as Draw from '#render/draw.ts'

import type { BeatComparison, BeatVerdict } from './beatRun.ts'

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

export const beatVerdictShapes: {
  (
    centerX: number,
    y: number,
  ): (comparison: BeatComparison) => ReadonlyArray<Draw.Shape>
  (
    comparison: BeatComparison,
    centerX: number,
    y: number,
  ): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (
    { verdict, line }: BeatComparison,
    centerX: number,
    y: number,
  ): ReadonlyArray<Draw.Shape> => {
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

export const friendRowShapes: {
  (centerX: number, y: number): (comparison: BeatComparison) => Draw.Shape
  (comparison: BeatComparison, centerX: number, y: number): Draw.Shape
} = Function.dual(
  3,
  ({ friend }: BeatComparison, centerX: number, y: number): Draw.Shape => {
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
