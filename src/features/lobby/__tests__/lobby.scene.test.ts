import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { Dialog } from '@effect/ui-kit'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it } from '@effect/vitest'

import { specialsOf } from '#domain/callingSpecials.ts'
import { Lobby } from '#features/lobby/block.ts'
import { HERO_DIALOG_ID } from '#features/lobby/lobby.ts'
import { Events } from '#features/lobby/message.ts'
import { heroesBoughtBy, home } from '#test/model.fixture.ts'
import {
  ackHudSlots,
  button,
  byClass,
  dialogModel,
  emitPressedKey,
  expectAttr,
  firstOf,
  homeUnderLobby,
  lobbyBackButton,
  lobbyScreen,
  lobbyStartButton,
  lockedNightmare,
  measureSurface,
  openLobbyInScene,
  playButton,
  statusLine,
  throughIntroInScene,
  withAttrs,
} from '#test/sceneTesting.ts'
import {
  type SceneStep,
  foldLobby,
  resolveFocusLobby,
  sceneOf,
} from '#test/testing.ts'
import { pointsForRank } from '#world/heroes/rank.ts'

import {
  expectLobbyDrawn,
  focusesPlay,
  lobbyAttr,
  lobbySceneIn,
} from './lobby.fixture.ts'

const handyman = UiStruct.evolve(home, {
  rank: current => ({ ...current, earnedPoints: pointsForRank(3) }),
  boughtCosmetics: () => heroesBoughtBy(3),
  calling: () => 'Handyman',
  playerName: () => 'Mo',
})

const playUnderLobby = HtmlLocator.role('button', {
  name: 'Play',
  hidden: true,
})

const players = HtmlLocator.role('list', { name: 'Players' })

const addBot = firstOf(button('Add a bot teammate'))

const removeBot = button(/^Remove /)

const friendlyFire = withAttrs({ 'data-modifier': 'FriendlyFire' })(
  byClass('modifier-pick'),
)

const bonus = (text: string) => HtmlLocator.role('status', { name: text })

const lobbySays =
  (event: Events): SceneStep =>
  s =>
    s.childEmit(Lobby, 'lobby', event)

describe('the lobby', () => {
  it.effect(
    'unfolds from PLAY as a card over the home menu, which stays in sight but takes nothing',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          expectLobbyDrawn(false),
          expectAttr(homeUnderLobby, 'inert', undefined),
          openLobbyInScene,
          expectLobbyDrawn(true),
          expectAttr(homeUnderLobby, 'inert', ''),
          expectAttr(homeUnderLobby, 'aria-hidden', 'true'),
        )
          .expect(playUnderLobby)
          .toExist()
        const lobby = yield* lobbySceneIn(s)
        lobby
          .pipe(
            lobbyAttr(lobbyScreen, 'data-state', 'Open'),
            lobbyAttr(byClass('dare-fold'), 'aria-hidden', 'true'),
            lobbyAttr(lobbyStartButton, 'aria-keyshortcuts', 'Enter'),
            lobbyAttr(lobbyBackButton, 'aria-keyshortcuts', 'Escape'),
          )
          .expect(Locator.inside(lobbyScreen, byClass('dare-card')))
          .toExist()
      }),
  )

  it.effect(
    'reads as a dare card: a word or two a line, SHAKE ON IT, and CHICKEN OUT',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(handyman)
        s.pipe(measureSurface, openLobbyInScene)
        const lobby = yield* lobbySceneIn(s)
        const line = (text: string) =>
          Locator.inside(lobbyScreen, Locator.text(text))
        lobby
          .expect(line('GOING IN'))
          .toExist()
          .expect(line('COMING AS'))
          .toExist()
          .expect(line('DRAG ALONG'))
          .toExist()
          .expect(line('OUT OR STAY'))
          .toExist()
          .expect(line('STAKES'))
          .toExist()
          .expect(line('EXTRA DARES'))
          .toExist()
          .expect(line('WHICH HOUSE'))
          .toExist()
          .expect(Locator.inside(lobbyScreen, byClass('dare-scrawl')))
          .toHaveCount(7)
          .expect(lobbyStartButton)
          .toHaveText(/SHAKE ON IT/)
          .expect(lobbyBackButton)
          .toHaveText(/CHICKEN OUT/)
          .expect(Locator.text('START'))
          .toBeAbsent()
      }),
  )

  it.effect(
    'CHICKEN OUT by a tap folds the card back into PLAY and focuses PLAY',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(measureSurface, openLobbyInScene)
        const open = yield* lobbySceneIn(s)
        open.click(lobbyBackButton).emitted(Events.RequestedLeave())
        s.pipe(
          lobbySays(Events.RequestedLeave()),
          focusesPlay,
          expectAttr(homeUnderLobby, 'inert', undefined),
        )
        const folding = yield* lobbySceneIn(s)
        folding
          .pipe(
            lobbyAttr(
              withAttrs({ 'data-state': 'Folding' })(byClass('lobby')),
              'inert',
              '',
            ),
          )
          .expect(lobbyScreen)
          .toBeAbsent()
        s.pipe(foldLobby, expectLobbyDrawn(false)).expect(playButton).toExist()
      }),
  )

  it.effect('Escape folds the card back into PLAY and focuses PLAY', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        measureSurface,
        openLobbyInScene,
        emitPressedKey('Escape'),
        focusesPlay,
      )
      const folding = yield* lobbySceneIn(s)
      folding.expect(lobbyScreen).toBeAbsent()
      s.pipe(foldLobby, expectLobbyDrawn(false))
    }),
  )

  it.effect('a tap on the dim around the card folds it back', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(measureSurface, openLobbyInScene)
      const open = yield* lobbySceneIn(s)
      open.click(byClass('lobby-backdrop')).emitted(Events.RequestedLeave())
      s.pipe(lobbySays(Events.RequestedLeave()), focusesPlay)
      const folding = yield* lobbySceneIn(s)
      folding.expect(lobbyScreen).toBeAbsent()
      s.pipe(foldLobby)
    }),
  )

  it.effect(
    'seats you with your name, rank, and hero card, and offers three + BOT seats',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(handyman)
        s.pipe(measureSurface, openLobbyInScene)
        const lobby = yield* lobbySceneIn(s)
        lobby
          .pipe(
            lobbyAttr(
              Locator.inside(players, addBot),
              'aria-keyshortcuts',
              'B',
            ),
            lobbyAttr(
              button(/^Hero: Handyman\. Plus: Traps 50% sturdier/),
              'aria-keyshortcuts',
              'Y',
            ),
          )
          .expect(
            Locator.inside(
              players,
              HtmlLocator.role('listitem', { name: 'Mo, you, rank 3' }),
            ),
          )
          .toExist()
          .expect(
            Locator.inside(
              players,
              Locator.inside(byClass('lobby-seat'), byClass('coop-nameplate')),
            ),
          )
          .toExist()
          .expect(Locator.inside(players, byClass('lobby-seat-empty')))
          .toHaveCount(3)
          .expect(Locator.inside(players, byClass('lobby-add-bot')))
          .toHaveCount(3)
          .expect(byClass('lobby-special'))
          .toHaveCount(specialsOf('Handyman').length)
      }),
  )

  it.effect(
    'a tap on + BOT seats a bot with its name, hero card, and an x, and the x sends it home',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(measureSurface, openLobbyInScene)
        const empty = yield* lobbySceneIn(s)
        empty.click(addBot).emitted(Events.RequestedAddBot())
        s.pipe(lobbySays(Events.RequestedAddBot()), resolveFocusLobby())
        const seated = yield* lobbySceneIn(s)
        seated
          .expect(
            Locator.inside(
              players,
              HtmlLocator.role('listitem', { name: /, bot teammate, YOU$/ }),
            ),
          )
          .toExist()
          .expect(Locator.inside(players, byClass('lobby-add-bot')))
          .toHaveCount(2)
          .expect(Locator.inside(players, byClass('lobby-hero-bot')))
          .toHaveCount(1)
          .expect(Locator.inside(players, removeBot))
          .toExist()
          .click(removeBot)
          .emitted(Events.RequestedDropBot({ index: 0 }))
        s.pipe(lobbySays(Events.RequestedDropBot({ index: 0 })))
        const sentHome = yield* lobbySceneIn(s)
        sentHome
          .expect(byClass('lobby-add-bot'))
          .toHaveCount(3)
          .expect(byClass('lobby-seat-bot'))
          .toBeAbsent()
        s.pipe(resolveFocusLobby())
      }),
  )

  it.effect('picks the mode, the difficulty, and the one map', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(measureSurface, openLobbyInScene)
      const nightmare = withAttrs({ 'data-difficulty': 'Nightmare' })(
        Locator.attr('data-difficulty'),
      )
      const lobby = yield* lobbySceneIn(s)
      lobby
        .pipe(
          lobbyAttr(button('Campaign'), 'aria-pressed', 'true'),
          lobbyAttr(button('Endless'), 'aria-pressed', 'false'),
          lobbyAttr(lockedNightmare, 'aria-disabled', 'true'),
        )
        .expect(byClass('coop-skull-pick'))
        .toHaveCount(4)
        .expect(Locator.inside(nightmare, byClass('coop-pick-icon')))
        .toExist()
        .expect(
          Locator.inside(byClass('coop-skull-pick'), byClass('lock-badge')),
        )
        .toHaveCount(1)
        .expect(Locator.inside(nightmare, byClass('lock-badge')))
        .toExist()
        .expect(HtmlLocator.role('img', { name: 'Map: The Manor' }))
        .toExist()
        .expect(byClass('lobby-map'))
        .toHaveCount(1)
    }),
  )

  it.effect('offers the four run modifiers as tiles with a total bonus', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(measureSurface, openLobbyInScene)
      const modifiers = HtmlLocator.role('group', { name: 'Modifiers' })
      const none = yield* lobbySceneIn(s)
      none
        .expect(Locator.inside(modifiers, byClass('modifier-pick')))
        .toHaveCount(4)
        .expect(Locator.inside(modifiers, bonus('Bonus +0%')))
        .toExist()
        .click(button('Glass, +350%, off'))
        .emitted(Events.ToggledModifier({ modifier: 'Glass' }))
      s.pipe(lobbySays(Events.ToggledModifier({ modifier: 'Glass' })))
      const glass = yield* lobbySceneIn(s)
      glass
        .pipe(lobbyAttr(button('Glass, +350%, on'), 'aria-pressed', 'true'))
        .click(button('Big Crowd, +25%, off'))
        .emitted(Events.ToggledModifier({ modifier: 'BigCrowd' }))
      s.pipe(lobbySays(Events.ToggledModifier({ modifier: 'BigCrowd' })))
      const both = yield* lobbySceneIn(s)
      both
        .expect(bonus('Bonus +375%'))
        .toExist()
        .click(button('Glass, +350%, on'))
        .emitted(Events.ToggledModifier({ modifier: 'Glass' }))
      s.pipe(lobbySays(Events.ToggledModifier({ modifier: 'Glass' })))
      const crowd = yield* lobbySceneIn(s)
      crowd.expect(bonus('Bonus +25%')).toExist()
    }),
  )

  it.effect(
    'Friendly Fire is dim until a bot sits in the crew, then it works',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(measureSurface, openLobbyInScene)
        const alone = yield* lobbySceneIn(s)
        alone.pipe(
          lobbyAttr(friendlyFire, 'data-available', 'No'),
          lobbyAttr(friendlyFire, 'aria-disabled', 'true'),
        )
        s.pipe(lobbySays(Events.RequestedAddBot()), resolveFocusLobby())
        const crewed = yield* lobbySceneIn(s)
        crewed
          .pipe(lobbyAttr(friendlyFire, 'data-available', 'Yes'))
          .click(button('Friendly Fire, +15%, off'))
          .emitted(Events.ToggledModifier({ modifier: 'FriendlyFire' }))
        s.pipe(lobbySays(Events.ToggledModifier({ modifier: 'FriendlyFire' })))
        const on = yield* lobbySceneIn(s)
        on.expect(bonus('Bonus +15%')).toExist()
      }),
  )

  it.effect('shows key caps to a keyboard and none to a finger', () =>
    Effect.gen(function* () {
      const keys = yield* sceneOf(home)
      keys.pipe(measureSurface, openLobbyInScene)
      const keyLobby = yield* lobbySceneIn(keys)
      keyLobby
        .expect(Locator.inside(lobbyScreen, byClass('home-key')))
        .toHaveCount(6)
      const touch = yield* sceneOf(
        UiStruct.evolve(home, { lastDevice: () => 'Touch' }),
      )
      touch.pipe(measureSurface, openLobbyInScene)
      const touchLobby = yield* lobbySceneIn(touch)
      touchLobby
        .expect(Locator.inside(lobbyScreen, byClass('home-key')))
        .toBeAbsent()
    }),
  )

  it.effect('START plays, and the mode tile and the skulls only pick', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(measureSurface, openLobbyInScene)
      const campaign = yield* lobbySceneIn(s)
      campaign
        .click(button('Endless'))
        .emitted(Events.PickedMode({ mode: 'Endless' }))
      s.pipe(
        lobbySays(Events.PickedMode({ mode: 'Endless' })),
        resolveFocusLobby(),
        expectLobbyDrawn(true),
      )
      const endless = yield* lobbySceneIn(s)
      endless.click(lobbyStartButton).emitted(Events.RequestedStart())
      s.pipe(
        lobbySays(Events.RequestedStart()),
        expectLobbyDrawn(false),
        throughIntroInScene,
        ackHudSlots,
      )
        .expect(statusLine)
        .toHaveText(/Get ready for endless wave 1\./)
    }),
  )

  it.effect('the hero card opens the picker over the lobby', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(handyman)
      s.pipe(measureSurface, openLobbyInScene)
      const lobby = yield* lobbySceneIn(s)
      lobby.click(button(/^Hero:/)).emitted(Events.RequestedHeroPicker())
      s.pipe(lobbySays(Events.RequestedHeroPicker()))
      const picking = yield* lobbySceneIn(s)
      picking
        .givenChild(Dialog, HERO_DIALOG_ID, dialogModel(true))
        .expect(HtmlLocator.role('dialog', { name: 'Hero' }))
        .toExist()
        .expect(HtmlLocator.role('region', { name: 'Lobby', hidden: true }))
        .toExist()
    }),
  )
})
