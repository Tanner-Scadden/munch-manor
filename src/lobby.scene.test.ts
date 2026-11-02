import {
  all,
  click,
  expect,
  expectAll,
  given,
  inside,
  role,
  scene,
  selector,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { specialsOf } from './callingSpecials'
import { home } from './model.fixture'
import { pointsForRank } from './rank'
import {
  ROOT,
  lobbyBackButton,
  lobbyScreen,
  lobbyStartButton,
  lockedNightmare,
  measureSurface,
  openLobbyInScene,
  playButton,
  resolveFocusLobbyInScene,
  showDialogInScene,
} from './testing'

// The single player lobby's view (src/lobbyView.ts): the co-op lobby's
// look, alone, with one seat, three waiting, the picks, and START.

const handyman = modifyFields(home, {
  rank: current => ({ ...current, earnedPoints: pointsForRank(3) }),
  calling: () => 'Handyman',
  playerName: () => 'Mo',
})

describe('the lobby', () => {
  test('replaces the home menu, with BACK and START and nothing else to press', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      expect(lobbyScreen).toBeAbsent(),
      ...openLobbyInScene(),
      expect(lobbyScreen).toExist(),
      expect(playButton).toBeAbsent(),
      expect(lobbyStartButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
      expect(lobbyBackButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
    )
  })

  test('seats you with your name, rank, and hero card, and offers three + BOT seats', () => {
    scene(
      ROOT,
      given(handyman),
      measureSurface,
      ...openLobbyInScene(),
      inside(
        role('list', { name: 'Players' }),
        expect(role('listitem', { name: 'Mo, you, rank 3' })).toExist(),
        expect(selector('.lobby-seat .coop-nameplate')).toExist(),
        expectAll(all.selector('.lobby-seat-empty')).toHaveCount(3),
        expectAll(all.selector('.lobby-add-bot')).toHaveCount(3),
        expect(role('button', { name: 'Add a bot teammate' })).toHaveAttr(
          'aria-keyshortcuts',
          'B',
        ),
      ),
      expect(
        role('button', { name: /^Hero: Handyman\. Plus: Planks 50% off/ }),
      ).toHaveAttr('aria-keyshortcuts', 'Y'),
      expectAll(all.selector('.lobby-special')).toHaveCount(
        specialsOf('Handyman').length,
      ),
    )
  })

  test('a tap on + BOT seats a bot with its name, hero card, and an x, and the x sends it home', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openLobbyInScene(),
      click(role('button', { name: 'Add a bot teammate' })),
      resolveFocusLobbyInScene(),
      inside(
        role('list', { name: 'Players' }),
        expect(role('listitem', { name: /, bot teammate, YOU$/ })).toExist(),
        expectAll(all.selector('.lobby-add-bot')).toHaveCount(2),
        expectAll(all.selector('.lobby-hero-bot')).toHaveCount(1),
        expect(role('button', { name: /^Remove / })).toExist(),
      ),
      click(role('button', { name: /^Remove / })),
      resolveFocusLobbyInScene(),
      expectAll(all.selector('.lobby-add-bot')).toHaveCount(3),
      expect(selector('.lobby-seat-bot')).toBeAbsent(),
    )
  })

  test('picks the mode, the difficulty, and the one map', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openLobbyInScene(),
      expect(role('button', { name: 'Campaign' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      expect(role('button', { name: 'Endless' })).toHaveAttr(
        'aria-pressed',
        'false',
      ),
      expectAll(all.selector('.coop-skull-pick')).toHaveCount(4),
      expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
      expect(role('img', { name: 'Map: The Manor' })).toExist(),
      expectAll(all.selector('.lobby-map')).toHaveCount(1),
    )
  })

  test('shows key caps to a keyboard and none to a finger', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openLobbyInScene(),
      expectAll(all.selector('.home-key')).toHaveCount(6),
    )
    scene(
      ROOT,
      given(modifyFields(home, { lastDevice: () => 'Touch' })),
      measureSurface,
      ...openLobbyInScene(),
      expect(selector('.home-key')).toBeAbsent(),
    )
  })

  test('START plays, and the mode tile and the skulls only pick', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openLobbyInScene(),
      click(role('button', { name: 'Endless' })),
      resolveFocusLobbyInScene(),
      expect(lobbyScreen).toExist(),
      click(lobbyStartButton),
      expect(lobbyScreen).toBeAbsent(),
      expect(role('status')).toContainText('Get ready for endless wave 1.'),
    )
  })

  test('the hero card opens the picker over the lobby', () => {
    scene(
      ROOT,
      given(handyman),
      measureSurface,
      ...openLobbyInScene(),
      click(role('button', { name: /^Hero:/ })),
      ...showDialogInScene(),
      expect(role('dialog', { name: 'Hero' })).toExist(),
      expect(lobbyScreen).toExist(),
    )
  })
})
