import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  CALLING_FLIP_MS,
  RANK_FILL_MS,
  RANK_POP_MS,
  UNLOCK_HOLD_MS,
  beatSounds,
  doneMs,
  isBeatOver,
  rankDoneMs,
  rankStripAtMs,
  skipBeat,
  unlockFlipAtMs,
  unlockStartMs,
  unlocksOf,
} from './endBeat'
import { endOverlayShapes } from './endView'
import { type Model, Phase, RunMode } from './model'
import { readyModel } from './model.fixture'

// The rank strip on the end card (src/endBeat.ts, src/rankStripView.ts):
// it comes after the tally, fills its bar, and on a rank up pops with a
// fanfare. A press skips to its end.

type Gain = Model['maybeRankGain']

const ended = (gain: Gain, screenMs = 0): Model =>
  modifyFields(readyModel, {
    phase: () => Phase.GameOver({ wave: 4 }),
    mode: () => RunMode.Campaign(),
    screenMs: () => screenMs,
    maybeRankGain: () => gain,
  })

const noGain: Gain = Option.none()
// NOTE: 70 points is rank 1 with 30 to go, so 60 more reach rank 2.
const rankUp: Gain = Option.some({
  pointsBefore: 70,
  gained: 60,
  bonesGained: 6,
})
const sameRank: Gain = Option.some({
  pointsBefore: 10,
  gained: 60,
  bonesGained: 6,
})

const stripAt = (gain: Gain): number => rankStripAtMs(ended(gain), 'Munched')

describe('the end card beat with a rank strip', () => {
  test('lasts until the bar has filled, and the pop when the rank is up', () => {
    expect(rankDoneMs(ended(sameRank), 'Munched')).toBe(
      stripAt(sameRank) + RANK_FILL_MS,
    )
    // NOTE: rank 2 gifts the Party Hat, whose card flips after the pop.
    expect(rankDoneMs(ended(rankUp), 'Munched')).toBe(
      stripAt(rankUp) + RANK_FILL_MS + RANK_POP_MS + CALLING_FLIP_MS,
    )
    expect(isBeatOver(ended(sameRank, doneMs('Munched')))).toBe(false)
    expect(isBeatOver(ended(noGain, doneMs('Munched')))).toBe(true)
  })

  test('a press skips to the end of the strip', () => {
    const skipped = skipBeat(ended(rankUp, 500))
    expect(skipped.screenMs).toBe(rankDoneMs(ended(rankUp), 'Munched'))
    expect(isBeatOver(skipped)).toBe(true)
  })

  test('a run with no strip skips to the end of the tally as before', () => {
    expect(skipBeat(ended(noGain, 500)).screenMs).toBe(doneMs('Munched'))
  })
})

describe('the strip draws', () => {
  // NOTE: every shape, groups opened, since the strip is drawn in one.
  const count = (shapes: ReadonlyArray<Canvas.Shape>): number =>
    Array.reduce(
      shapes,
      0,
      (total, shape) =>
        total + 1 + (shape._tag === 'Group' ? count(shape.shapes) : 0),
    )

  const shapesAt = (gain: Gain, screenMs: number) =>
    count(endOverlayShapes(ended(gain, screenMs)))

  test('nothing before its turn, then the badge, number, bar, and Bones', () => {
    const start = stripAt(rankUp)
    // NOTE: the badge, number, bar (back, fill, shine, edge), bone, and text.
    expect(
      shapesAt(rankUp, start + RANK_FILL_MS) - shapesAt(rankUp, start - 10),
    ).toBeGreaterThan(6)
    expect(shapesAt(noGain, start + RANK_FILL_MS)).toBe(
      shapesAt(noGain, start - 10),
    )
  })

  test('a rank up throws sparks, the same fill without one does not', () => {
    const popAt = stripAt(rankUp) + RANK_FILL_MS + 100
    expect(shapesAt(rankUp, popAt)).toBeGreaterThan(shapesAt(sameRank, popAt))
  })
})

describe('the strip sounds', () => {
  const across = (gain: Gain, fromMs: number, toMs: number) =>
    beatSounds(ended(gain), fromMs, toMs)

  test('a rank up plays the fanfare as the bar fills, a same rank does not', () => {
    const fills = stripAt(rankUp) + RANK_FILL_MS
    expect(across(rankUp, fills - 5, fills + 5)).toContain('RankUp')
    expect(across(sameRank, fills - 5, fills + 5)).not.toContain('RankUp')
    expect(across(noGain, fills - 5, fills + 5)).not.toContain('RankUp')
  })

  test('the strip arrives with a pop', () => {
    const start = stripAt(sameRank)
    expect(across(sameRank, start - 5, start + 5)).toContain('Pop')
  })
})

describe('the cards a rank up flips', () => {
  // NOTE: rank 1 to 2 gifts the Party Hat.
  const hatGift: Gain = rankUp
  // NOTE: 1000 points is rank 7: the Handyman (rank 3) and the Track Star
  // (rank 6) open, and the hats gifted at ranks 2, 4, 5, and 7.
  const several: Gain = Option.some({
    pointsBefore: 0,
    gained: 1000,
    bonesGained: 100,
  })
  const tag = (model: Model) => unlocksOf(model).map(unlock => unlock._tag)

  test('a rank that reaches a gift flips the hat, none when it does not', () => {
    expect(unlocksOf(ended(hatGift))).toEqual([
      { _tag: 'Gift', kind: 'Hat', name: 'PartyHat' },
    ])
    expect(unlocksOf(ended(sameRank))).toEqual([])
    expect(unlocksOf(ended(noGain))).toEqual([])
  })

  test('several ranks at once flip the callings first, then the gifts', () => {
    expect(tag(ended(several))).toEqual([
      'Calling',
      'Calling',
      'Gift',
      'Gift',
      'Gift',
      'Gift',
    ])
    expect(
      unlocksOf(ended(several)).map(unlock =>
        unlock._tag === 'Gift' ? unlock.name : '',
      ),
    ).toEqual(['', '', 'PartyHat', 'BucketHat', 'PomBeanie', 'PropellerCap'])
  })

  test('each card flips after the last was held a moment, and a press skips them all', () => {
    expect(unlockStartMs(1) - unlockStartMs(0)).toBe(
      CALLING_FLIP_MS + UNLOCK_HOLD_MS,
    )
    const model = ended(several, 500)
    expect(rankDoneMs(model, 'Munched')).toBe(
      unlockFlipAtMs(model, 'Munched') + unlockStartMs(5) + CALLING_FLIP_MS,
    )
    expect(skipBeat(model).screenMs).toBe(rankDoneMs(model, 'Munched'))
  })

  test('the card in view is the one whose turn it is', () => {
    const at = (card: number, extraMs: number) => {
      const model = ended(several)
      return JSON.stringify(
        endOverlayShapes(
          modifyFields(model, {
            screenMs: () =>
              unlockFlipAtMs(model, 'Munched') + unlockStartMs(card) + extraMs,
          }),
        ),
      )
    }
    const settled = CALLING_FLIP_MS + 10
    expect(at(0, settled)).not.toBe(at(1, settled))
    expect(at(2, settled)).not.toBe(at(3, settled))
    // NOTE: before the first card flips there is none to show.
    expect(at(0, -10)).not.toBe(at(0, settled))
  })

  test('each card flips with a sound', () => {
    const model = ended(several)
    const flipAt = unlockFlipAtMs(model, 'Munched')
    expect(beatSounds(model, flipAt - 5, flipAt + 5)).toContain('LootPop')
    expect(
      beatSounds(
        model,
        flipAt + unlockStartMs(2) - 5,
        flipAt + unlockStartMs(2) + 5,
      ),
    ).toContain('LootPop')
    expect(beatSounds(ended(sameRank), flipAt - 5, flipAt + 5)).not.toContain(
      'LootPop',
    )
  })
})
