import { click, expect, given, role, scene, selector } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { home } from './model.fixture'
import type { Calling } from './playerData'
import { pointsForRank } from './rank'
import {
  ROOT,
  closeDialogInScene,
  emitPressedKey,
  measureSurface,
  showDialogInScene,
} from './testing'

// The calling pill by the difficulty and its picker (src/callingView.ts).

const callingPill = (name: string | RegExp) => role('button', { name })

const atRank = (rank: number, calling: Calling) =>
  modifyFields(home, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    calling: () => calling,
  })

describe('the calling pill', () => {
  test('shows the calling picked, with its key, and opens the picker', () => {
    scene(
      ROOT,
      given(atRank(3, 'Handyman')),
      measureSurface,
      expect(callingPill(/^Calling: Handyman\./)).toHaveAttr(
        'aria-keyshortcuts',
        'Y',
      ),
      expect(callingPill(/^Calling: Handyman\./)).toHaveAttr(
        'aria-haspopup',
        'dialog',
      ),
      click(callingPill(/^Calling: Handyman\./)),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Calling' })).toExist(),
    )
  })

  test('Y opens the picker on a keyboard', () => {
    scene(
      ROOT,
      given(atRank(1, 'You')),
      measureSurface,
      emitPressedKey('KeyY'),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Calling' })).toExist(),
    )
  })
})

describe('the picker', () => {
  test('deals five cards: the unlocked ones to pick and the locked ones dark with their rank', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      click(callingPill(/^Calling: YOU\./)),
      ...showDialogInScene(),
      expect(selector(".calling-card[data-lock='Open']")).toExist(),
      expect(
        role('button', { name: /^Handyman: Plank Piles cost half/ }),
      ).toExist(),
      expect(
        role('button', { name: 'Locked. Reach rank 6 to unlock' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(
        role('button', { name: 'Locked. Reach rank 15 to unlock' }),
      ).toExist(),
      expect(selector('.calling-need .rank-chip')).toExist(),
    )
  })

  test('picking an unlocked calling closes the picker and changes the pill', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      click(callingPill(/^Calling: YOU\./)),
      ...showDialogInScene(),
      click(role('button', { name: /^Handyman:/ })),
      ...closeDialogInScene(),
      expect(callingPill(/^Calling: Handyman\./)).toExist(),
    )
  })

  test('a locked card is disabled, so a tap on it picks nothing', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      click(callingPill(/^Calling: YOU\./)),
      ...showDialogInScene(),
      expect(
        role('button', { name: 'Locked. Reach rank 6 to unlock' }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(callingPill(/^Calling: YOU\./)).toExist(),
    )
  })
})
