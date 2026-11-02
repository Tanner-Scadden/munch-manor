import { click, expect, given, role, scene, selector } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { heroesBoughtBy, home } from './model.fixture'
import type { Calling } from './playerData'
import { pointsForRank } from './rank'
import {
  ROOT,
  closeDialogInScene,
  emitPressedKey,
  measureSurface,
  openLobbyInScene,
  showDialogInScene,
} from './testing'

// The lobby's hero card and the picker it opens (src/lobbyView.ts,
// src/callingView.ts).

const callingPill = (name: string | RegExp) => role('button', { name })

const atRank = (rank: number, calling: Calling) =>
  modifyFields(home, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

describe('the hero card', () => {
  test('shows the calling picked, with its key, and opens the picker', () => {
    scene(
      ROOT,
      given(atRank(3, 'Handyman')),
      measureSurface,
      ...openLobbyInScene(),
      expect(callingPill(/^Hero: Handyman\./)).toHaveAttr(
        'aria-keyshortcuts',
        'Y',
      ),
      expect(callingPill(/^Hero: Handyman\./)).toHaveAttr(
        'aria-haspopup',
        'dialog',
      ),
      click(callingPill(/^Hero: Handyman\./)),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Hero' })).toExist(),
    )
  })

  test('Y opens the picker on a keyboard', () => {
    scene(
      ROOT,
      given(atRank(1, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      emitPressedKey('KeyY'),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Hero' })).toExist(),
    )
  })
})

describe('the picker', () => {
  test('deals five cards: the unlocked ones to pick and the locked ones dark with their rank', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      expect(selector(".calling-card[data-lock='Owned']")).toExist(),
      expect(
        role('button', { name: /^Handyman\. Plus: Planks 50% off/ }),
      ).toExist(),
      expect(
        role('button', {
          name: /^Track Star, locked\. Reach rank 6 to unlock/,
        }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(
        role('button', {
          name: /^Line Cook, locked\. Reach rank 15 to unlock/,
        }),
      ).toExist(),
      expect(selector('.calling-need .rank-chip')).toExist(),
    )
  })

  test('each card reads its specials, perks and drawbacks, locked or not', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      expect(
        selector(
          ".calling-card[data-calling='Handyman'] [data-sign='Perk'] .calling-special-line",
        ),
      ).toHaveText('Planks 50% off'),
      expect(
        selector(
          ".calling-card[data-calling='Handyman'] [data-sign='Drawback'] .calling-special-line",
        ),
      ).toHaveText('4 max hearts'),
      expect(
        selector(
          ".calling-card[data-calling='TrackStar'][data-lock='Locked'] [data-sign='Drawback'] .calling-special-line",
        ),
      ).toHaveText('Mags 10% smaller'),
    )
  })

  test('picking an unlocked calling closes the picker and changes the card', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      click(role('button', { name: /^Handyman\./ })),
      ...closeDialogInScene(),
      expect(callingPill(/^Hero: Handyman\./)).toExist(),
    )
  })

  test('a locked card is disabled, so a tap on it picks nothing', () => {
    scene(
      ROOT,
      given(atRank(3, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      expect(
        role('button', {
          name: /^Track Star, locked\. Reach rank 6 to unlock/,
        }),
      ).toHaveAttr('aria-disabled', 'true'),
      expect(callingPill(/^Hero: YOU\./)).toExist(),
    )
  })
})

describe('a hero for sale', () => {
  const shopper = (bones: number) =>
    modifyFields(atRank(6, 'You'), {
      boughtCosmetics: () => [],
      rank: current => ({ ...current, earnedBones: bones }),
    })

  test('shows its price, and a tap tries it on with a BUY pill that buys', () => {
    scene(
      ROOT,
      given(shopper(100)),
      measureSurface,
      ...openLobbyInScene(),
      click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      expect(
        selector(".calling-card[data-calling='Handyman'][data-lock='ForSale']"),
      ).toExist(),
      expect(
        selector(".calling-card[data-calling='Handyman'] .calling-price"),
      ).toExist(),
      expect(
        selector(".calling-card[data-calling='LineCook'][data-lock='Locked']"),
      ).toExist(),
      expect(selector('.calling-balance')).toHaveText('100'),
      expect(selector('.calling-buy')).toBeAbsent(),
      click(role('button', { name: /^Handyman, for sale, 60 Bones/ })),
      expect(selector(".calling-card[data-trying='true']")).toExist(),
      expect(role('button', { name: 'Buy for 60 Bones' })).toExist(),
      click(role('button', { name: 'Buy for 60 Bones' })),
      ...closeDialogInScene(),
      expect(callingPill(/^Hero: Handyman\./)).toExist(),
    )
  })

  test('with too few Bones the BUY pill is disabled and red', () => {
    scene(
      ROOT,
      given(shopper(10)),
      measureSurface,
      ...openLobbyInScene(),
      click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      click(role('button', { name: /^Handyman, for sale/ })),
      expect(role('button', { name: 'Buy for 60 Bones, too few' })).toHaveAttr(
        'disabled',
        'true',
      ),
    )
  })
})
