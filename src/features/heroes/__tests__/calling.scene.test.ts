import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import type { Calling } from '../../../shared/playerData'
import { heroesBoughtBy, home } from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialogInScene,
  emitPressedKey,
  measureSurface,
  openLobbyInScene,
  showDialogInScene,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'

// The lobby's hero card and the picker it opens (src/features/lobby/lobbyView.ts,
// src/features/heroes/callingView.ts).

const callingPill = (name: string | RegExp) => Scene.role('button', { name })

const atRank = (rank: number, calling: Calling) =>
  modifyFields(home, {
    rank: current => ({ ...current, earnedPoints: pointsForRank(rank) }),
    boughtCosmetics: () => heroesBoughtBy(rank),
    calling: () => calling,
  })

describe('the hero card', () => {
  it.effect(
    'shows the calling picked, with its key, and opens the picker',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atRank(3, 'Handyman')),
        measureSurface,
        ...openLobbyInScene(),
        Scene.expect(callingPill(/^Hero: Handyman\./)).toHaveAttr(
          'aria-keyshortcuts',
          'Y',
        ),
        Scene.expect(callingPill(/^Hero: Handyman\./)).toHaveAttr(
          'aria-haspopup',
          'dialog',
        ),
        Scene.click(callingPill(/^Hero: Handyman\./)),
        ...showDialogInScene(),
        Scene.expect(Scene.role('dialog', { name: 'Hero' })).toExist(),
      ),
  )

  it.effect('Y opens the picker on a keyboard', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(atRank(1, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      emitPressedKey('KeyY'),
      ...showDialogInScene(),
      Scene.expect(Scene.role('dialog', { name: 'Hero' })).toExist(),
    ),
  )
})

describe('the picker', () => {
  it.effect(
    'deals five cards: the unlocked ones to pick and the locked ones dark with their rank',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atRank(3, 'You')),
        measureSurface,
        ...openLobbyInScene(),
        Scene.click(callingPill(/^Hero: YOU\./)),
        ...showDialogInScene(),
        Scene.expect(
          Scene.selector(".calling-card[data-lock='Owned']"),
        ).toExist(),
        Scene.expect(
          Scene.role('button', { name: /^Handyman\. Plus: Planks 50% off/ }),
        ).toExist(),
        Scene.expect(
          Scene.role('button', {
            name: /^Track Star, locked\. Reach rank 6 to unlock/,
          }),
        ).toHaveAttr('aria-disabled', 'true'),
        Scene.expect(
          Scene.role('button', {
            name: /^Line Cook, locked\. Reach rank 15 to unlock/,
          }),
        ).toExist(),
        Scene.expect(Scene.selector('.calling-need .rank-chip')).toExist(),
      ),
  )

  it.effect(
    'each card reads its specials, perks and drawbacks, locked or not',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atRank(3, 'You')),
        measureSurface,
        ...openLobbyInScene(),
        Scene.click(callingPill(/^Hero: YOU\./)),
        ...showDialogInScene(),
        Scene.expect(
          Scene.selector(
            ".calling-card[data-calling='Handyman'] [data-sign='Perk'] .calling-special-line",
          ),
        ).toHaveText('Planks 50% off'),
        Scene.expect(
          Scene.selector(
            ".calling-card[data-calling='Handyman'] [data-sign='Drawback'] .calling-special-line",
          ),
        ).toHaveText('4 max hearts'),
        Scene.expect(
          Scene.selector(
            ".calling-card[data-calling='TrackStar'][data-lock='Locked'] [data-sign='Drawback'] .calling-special-line",
          ),
        ).toHaveText('Mags 5% smaller'),
      ),
  )

  it.effect(
    'picking an unlocked calling closes the picker and changes the card',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atRank(3, 'You')),
        measureSurface,
        ...openLobbyInScene(),
        Scene.click(callingPill(/^Hero: YOU\./)),
        ...showDialogInScene(),
        Scene.click(Scene.role('button', { name: /^Handyman\./ })),
        ...closeDialogInScene(),
        Scene.expect(callingPill(/^Hero: Handyman\./)).toExist(),
      ),
  )

  it.effect('a locked card is disabled, so a tap on it picks nothing', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(atRank(3, 'You')),
      measureSurface,
      ...openLobbyInScene(),
      Scene.click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      Scene.expect(
        Scene.role('button', {
          name: /^Track Star, locked\. Reach rank 6 to unlock/,
        }),
      ).toHaveAttr('aria-disabled', 'true'),
      Scene.expect(callingPill(/^Hero: YOU\./)).toExist(),
    ),
  )
})

describe('a hero for sale', () => {
  const shopper = (bones: number) =>
    modifyFields(atRank(6, 'You'), {
      boughtCosmetics: () => [],
      rank: current => ({ ...current, earnedBones: bones }),
    })

  it.effect(
    'shows its price, and a tap tries it on with a BUY pill that buys',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(shopper(100)),
        measureSurface,
        ...openLobbyInScene(),
        Scene.click(callingPill(/^Hero: YOU\./)),
        ...showDialogInScene(),
        Scene.expect(
          Scene.selector(
            ".calling-card[data-calling='Handyman'][data-lock='ForSale']",
          ),
        ).toExist(),
        Scene.expect(
          Scene.selector(
            ".calling-card[data-calling='Handyman'] .calling-price",
          ),
        ).toExist(),
        Scene.expect(
          Scene.selector(
            ".calling-card[data-calling='LineCook'][data-lock='Locked']",
          ),
        ).toExist(),
        Scene.expect(Scene.selector('.calling-balance')).toHaveText('100'),
        Scene.expect(Scene.selector('.calling-buy')).toBeAbsent(),
        Scene.click(
          Scene.role('button', { name: /^Handyman, for sale, 60 Bones/ }),
        ),
        Scene.expect(
          Scene.selector(".calling-card[data-trying='true']"),
        ).toExist(),
        Scene.expect(
          Scene.role('button', { name: 'Buy for 60 Bones' }),
        ).toExist(),
        Scene.click(Scene.role('button', { name: 'Buy for 60 Bones' })),
        ...closeDialogInScene(),
        Scene.expect(callingPill(/^Hero: Handyman\./)).toExist(),
      ),
  )

  it.effect('with too few Bones the BUY pill is disabled and red', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(shopper(10)),
      measureSurface,
      ...openLobbyInScene(),
      Scene.click(callingPill(/^Hero: YOU\./)),
      ...showDialogInScene(),
      Scene.click(Scene.role('button', { name: /^Handyman, for sale/ })),
      Scene.expect(
        Scene.role('button', { name: 'Buy for 60 Bones, too few' }),
      ).toHaveAttr('disabled', 'true'),
    ),
  )
})
