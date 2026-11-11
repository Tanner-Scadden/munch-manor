import { Effect } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { FocusHomeButton } from '../../../app/update/home'
import { specialsOf } from '../../../domain/callingSpecials'
import { heroesBoughtBy, home } from '../../../test/model.fixture'
import {
  APPLICATION,
  lobbyBackButton,
  lobbyScreen,
  lobbyStartButton,
  lockedNightmare,
  measureSurface,
  openLobbyInScene,
  playButton,
  resolveFocusLobbyInScene,
  showDialogInScene,
  throughIntroInScene,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'

// The single player lobby's view (src/features/lobby/view.ts): the dare card,
// the co-op lobby's layout alone on a napkin, with one seat, three waiting,
// the picks, and SHAKE ON IT.

const handyman = modifyFields(home, {
  rank: current => ({ ...current, earnedPoints: pointsForRank(3) }),
  boughtCosmetics: () => heroesBoughtBy(3),
  calling: () => 'Handyman',
  playerName: () => 'Mo',
})

describe('the lobby', () => {
  it.effect(
    'replaces the home menu, with BACK and START and nothing else to press',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        Scene.expect(lobbyScreen).toBeAbsent(),
        ...openLobbyInScene(),
        Scene.expect(lobbyScreen).toExist(),
        Scene.expect(playButton).toBeAbsent(),
        Scene.expect(lobbyStartButton).toHaveAttr('aria-keyshortcuts', 'Enter'),
        Scene.expect(lobbyBackButton).toHaveAttr('aria-keyshortcuts', 'Escape'),
      ),
  )

  it.effect(
    'reads as a dare card: a word or two a line, SHAKE ON IT, and CHICKEN OUT',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(handyman),
        measureSurface,
        ...openLobbyInScene(),
        Scene.inside(
          lobbyScreen,
          Scene.expect(Scene.text('GOING IN')).toExist(),
          Scene.expect(Scene.text('COMING AS')).toExist(),
          Scene.expect(Scene.text('DRAG ALONG')).toExist(),
          Scene.expect(Scene.text('OUT OR STAY')).toExist(),
          Scene.expect(Scene.text('STAKES')).toExist(),
          Scene.expect(Scene.text('EXTRA DARES')).toExist(),
          Scene.expect(Scene.text('WHICH HOUSE')).toExist(),
          Scene.expectAll(Scene.all.selector('.dare-scrawl')).toHaveCount(7),
        ),
        Scene.expect(lobbyStartButton).toContainText('SHAKE ON IT'),
        Scene.expect(lobbyBackButton).toContainText('CHICKEN OUT'),
        Scene.expect(Scene.text('START')).toBeAbsent(),
      ),
  )

  it.effect('CHICKEN OUT by a tap goes home to PLAY', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openLobbyInScene(),
      Scene.click(lobbyBackButton),
      Scene.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      Scene.expect(lobbyScreen).toBeAbsent(),
      Scene.expect(playButton).toExist(),
    ),
  )

  it.effect(
    'seats you with your name, rank, and hero card, and offers three + BOT seats',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(handyman),
        measureSurface,
        ...openLobbyInScene(),
        Scene.inside(
          Scene.role('list', { name: 'Players' }),
          Scene.expect(
            Scene.role('listitem', { name: 'Mo, you, rank 3' }),
          ).toExist(),
          Scene.expect(Scene.selector('.lobby-seat .coop-nameplate')).toExist(),
          Scene.expectAll(Scene.all.selector('.lobby-seat-empty')).toHaveCount(
            3,
          ),
          Scene.expectAll(Scene.all.selector('.lobby-add-bot')).toHaveCount(3),
          Scene.expect(
            Scene.role('button', { name: 'Add a bot teammate' }),
          ).toHaveAttr('aria-keyshortcuts', 'B'),
        ),
        Scene.expect(
          Scene.role('button', {
            name: /^Hero: Handyman\. Plus: Traps 50% sturdier/,
          }),
        ).toHaveAttr('aria-keyshortcuts', 'Y'),
        Scene.expectAll(Scene.all.selector('.lobby-special')).toHaveCount(
          specialsOf('Handyman').length,
        ),
      ),
  )

  it.effect(
    'a tap on + BOT seats a bot with its name, hero card, and an x, and the x sends it home',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openLobbyInScene(),
        Scene.click(Scene.role('button', { name: 'Add a bot teammate' })),
        resolveFocusLobbyInScene(),
        Scene.inside(
          Scene.role('list', { name: 'Players' }),
          Scene.expect(
            Scene.role('listitem', { name: /, bot teammate, YOU$/ }),
          ).toExist(),
          Scene.expectAll(Scene.all.selector('.lobby-add-bot')).toHaveCount(2),
          Scene.expectAll(Scene.all.selector('.lobby-hero-bot')).toHaveCount(1),
          Scene.expect(Scene.role('button', { name: /^Remove / })).toExist(),
        ),
        Scene.click(Scene.role('button', { name: /^Remove / })),
        resolveFocusLobbyInScene(),
        Scene.expectAll(Scene.all.selector('.lobby-add-bot')).toHaveCount(3),
        Scene.expect(Scene.selector('.lobby-seat-bot')).toBeAbsent(),
      ),
  )

  it.effect('picks the mode, the difficulty, and the one map', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openLobbyInScene(),
      Scene.expect(Scene.role('button', { name: 'Campaign' })).toHaveAttr(
        'aria-pressed',
        'true',
      ),
      Scene.expect(Scene.role('button', { name: 'Endless' })).toHaveAttr(
        'aria-pressed',
        'false',
      ),
      Scene.expectAll(Scene.all.selector('.coop-skull-pick')).toHaveCount(4),
      Scene.expect(lockedNightmare).toHaveAttr('aria-disabled', 'true'),
      Scene.expect(
        Scene.selector("[data-difficulty='Nightmare'] .coop-pick-icon"),
      ).toExist(),
      Scene.expectAll(
        Scene.all.selector('.coop-skull-pick .lock-badge'),
      ).toHaveCount(1),
      Scene.expect(
        Scene.selector("[data-difficulty='Nightmare'] .lock-badge"),
      ).toExist(),
      Scene.expect(Scene.role('img', { name: 'Map: The Manor' })).toExist(),
      Scene.expectAll(Scene.all.selector('.lobby-map')).toHaveCount(1),
    ),
  )

  it.effect('offers the four run modifiers as tiles with a total bonus', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openLobbyInScene(),
      Scene.inside(
        Scene.role('group', { name: 'Modifiers' }),
        Scene.expectAll(Scene.all.selector('.modifier-pick')).toHaveCount(4),
        Scene.expect(Scene.role('status', { name: 'Bonus +0%' })).toExist(),
      ),
      Scene.click(Scene.role('button', { name: 'Glass, +350%, off' })),
      Scene.expect(
        Scene.role('button', { name: 'Glass, +350%, on' }),
      ).toHaveAttr('aria-pressed', 'true'),
      Scene.click(Scene.role('button', { name: 'Big Crowd, +25%, off' })),
      Scene.expect(Scene.role('status', { name: 'Bonus +375%' })).toExist(),
      Scene.click(Scene.role('button', { name: 'Glass, +350%, on' })),
      Scene.expect(Scene.role('status', { name: 'Bonus +25%' })).toExist(),
    ),
  )

  it.effect(
    'Friendly Fire is dim until a bot sits in the crew, then it works',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openLobbyInScene(),
        Scene.expect(
          Scene.selector('.modifier-pick[data-modifier="FriendlyFire"]'),
        ).toHaveAttr('data-available', 'No'),
        Scene.expect(
          Scene.selector('.modifier-pick[data-modifier="FriendlyFire"]'),
        ).toHaveAttr('aria-disabled', 'true'),
        Scene.click(Scene.role('button', { name: 'Add a bot teammate' })),
        resolveFocusLobbyInScene(),
        Scene.expect(
          Scene.selector('.modifier-pick[data-modifier="FriendlyFire"]'),
        ).toHaveAttr('data-available', 'Yes'),
        Scene.click(Scene.role('button', { name: 'Friendly Fire, +15%, off' })),
        Scene.expect(Scene.role('status', { name: 'Bonus +15%' })).toExist(),
      ),
  )

  it.effect('shows key caps to a keyboard and none to a finger', () =>
    Effect.gen(function* () {
      yield* Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...openLobbyInScene(),
        Scene.expectAll(Scene.all.selector('.home-key')).toHaveCount(6),
      )
      yield* Scene.scene(
        APPLICATION,
        Scene.given(modifyFields(home, { lastDevice: () => 'Touch' })),
        measureSurface,
        ...openLobbyInScene(),
        Scene.expect(Scene.selector('.home-key')).toBeAbsent(),
      )
    }),
  )

  it.effect('START plays, and the mode tile and the skulls only pick', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openLobbyInScene(),
      Scene.click(Scene.role('button', { name: 'Endless' })),
      resolveFocusLobbyInScene(),
      Scene.expect(lobbyScreen).toExist(),
      Scene.click(lobbyStartButton),
      Scene.expect(lobbyScreen).toBeAbsent(),
      ...throughIntroInScene(),
      Scene.expect(Scene.role('status')).toContainText(
        'Get ready for endless wave 1.',
      ),
    ),
  )

  it.effect('the hero card opens the picker over the lobby', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(handyman),
      measureSurface,
      ...openLobbyInScene(),
      Scene.click(Scene.role('button', { name: /^Hero:/ })),
      ...showDialogInScene(),
      Scene.expect(Scene.role('dialog', { name: 'Hero' })).toExist(),
      Scene.expect(lobbyScreen).toExist(),
    ),
  )
})
