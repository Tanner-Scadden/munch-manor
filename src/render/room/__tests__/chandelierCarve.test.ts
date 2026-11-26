import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  carvedViewsOf,
  showpieceSheetOf,
  viewColorsOf,
} from '../../../art/carve'
import { carvedChandelierOf } from '../chandelierCarve'
import type { ChandelierState } from '../diningArt'

const STATES: ReadonlyArray<ChandelierState> = ['Hung', 'Fallen']

describe('the carved chandelier', () => {
  test.each(STATES)('keeps its front art exactly, %s', state => {
    const { model } = carvedChandelierOf(state)
    expect(viewColorsOf(carvedViewsOf(model).front)).toEqual(
      viewColorsOf(model.views.front),
    )
  })

  test.each(STATES)('is carved once and stands deep, %s', state => {
    const piece = carvedChandelierOf(state)
    expect(carvedChandelierOf(state)).toBe(piece)
    const sheet = showpieceSheetOf(piece.model)
    const depths = new Set(Array.map(sheet.voxels, ({ z }) => z))
    expect(depths.size).toBeGreaterThan(2)
  })
})
