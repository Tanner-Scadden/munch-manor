import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { LobbyBinding } from '../../../app/bindings'
import { MenuState, isLobbyOpen, menuState } from '../../../app/menuState'
import { Message } from '../../../app/message'
import { DifficultyCard, Lesson, Phase, RunMode } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { FocusHomeButton } from '../../../app/update/home'
import { Message as HeroPickerMessage } from '../../../features/heroes/message'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { FoldLobby } from '../../../features/lobby/steps'
import { RESTART_GRACE_MS } from '../../../shared/constants'
import {
  heroesBoughtBy,
  newPlayerCardSeen,
  readyModel,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  closeDialog,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
  startRunFromHome,
  throughIntro,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'
import { focusOf } from '../../../world/party/party'
import { HeroPickerBinding } from '../bindings'
import { FocusLobbyControl } from '../steps'

// The single player lobby (src/features/lobby/lobby.ts, src/features/lobby/update.ts): PLAY opens
// it, START plays what it holds, and BACK and Esc go home.

// NOTE: CHICKEN OUT folds the card back into PLAY, then it is gone.
const foldLobby = Story.Command.resolve(
  FoldLobby(),
  LobbyMessage.CompletedFold(),
)

describe('PLAY opens the lobby', () => {
  it.effect('a tap on PLAY opens it, focuses START, and starts no run', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.message(Message.ClickedPlayButton()),
      Story.Command.resolve(
        FocusLobbyControl({ control: 'Start' }),
        LobbyMessage.CompletedFocusControl(),
      ),
      Story.model(current => {
        expect(current.lobby.status).toBe('Open')
        expect(isLobbyOpen(current)).toBe(true)
        expect(menuState(current)._tag).toBe('Lobby')
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.lobby.maybeFocus).toEqual(Option.some('Start'))
      }),
    ),
  )

  it.effect(
    'Enter does the same, and the home keys that are not the lobby stop answering',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        press('KeyV'),
        press('KeyO'),
        Story.model(current => {
          expect(MenuState.isAnyOf(['Lobby'])(menuState(current))).toBe(true)
          expect(current.handDialog.isOpen).toBe(false)
          expect(current.profileDialog.isOpen).toBe(false)
        }),
      ),
  )
})

describe('START plays what the lobby holds', () => {
  const chosen = modifyFields(readyModel, {
    rank: rank => ({ ...rank, earnedPoints: pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
    calling: () => 'Handyman',
    difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
    home: home => modifyFields(home, { mode: () => 'Endless' }),
  })

  it.effect(
    'the run has the chosen mode, difficulty, and hero, and the lobby is gone',
    () =>
      Story.story(
        APPLICATION,
        Story.given(chosen),
        Story.message(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
        throughIntro,
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.mode).toEqual(RunMode.Endless())
          expect(current.difficulty.chosen).toBe('Hard')
          expect(focusOf(current).player.calling).toBe('Handyman')
          expect(current.lobby.status).toBe('Closed')
          expect(isLobbyOpen(current)).toBe(false)
        }),
      ),
  )

  it.effect('picks made in the lobby are what START plays', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedModeButton({ mode: 'Endless' }),
      ),
      resolveFocusLobby(),
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedDifficultyButton({ difficulty: 'Easy' }),
      ),
      resolveFocusLobby(),
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
      Story.model(current => {
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.difficulty.chosen).toBe('Easy')
      }),
    ),
  )

  it.effect(
    'Enter after a pick starts, since the pick moved focus to START',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedDifficultyButton({ difficulty: 'Hard' }),
        ),
        resolveFocusLobby(),
        press('Enter'),
        throughIntro,
        Story.model(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.difficulty.chosen).toBe('Hard')
        }),
      ),
  )

  it.effect('START does nothing when no lobby is open', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
      Story.model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
      }),
    ),
  )
})

describe('the hero card', () => {
  const ranked = modifyFields(readyModel, {
    rank: rank => ({ ...rank, earnedPoints: pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
  })

  it.effect(
    'opens the hero picker over the lobby, and a pick lands back in the lobby',
    () =>
      Story.story(
        APPLICATION,
        Story.given(ranked),
        openLobbyByKey,
        Story.messageIn(LobbyBinding, LobbyMessage.ClickedHeroButton()),
        showDialog(),
        Story.model(current => {
          expect(menuState(current)._tag).toBe('HeroPicker')
          expect(current.lobby.status).toBe('Open')
        }),
        Story.messageIn(
          [LobbyBinding, HeroPickerBinding],
          HeroPickerMessage.ClickedCard({ calling: 'Handyman' }),
        ),
        closeDialog(),
        Story.model(current => {
          expect(current.calling).toBe('Handyman')
          expect(menuState(current)._tag).toBe('Lobby')
        }),
      ),
  )

  it.effect('Y opens it from the keyboard', () =>
    Story.story(
      APPLICATION,
      Story.given(ranked),
      openLobbyByKey,
      press('KeyY'),
      showDialog(),
      Story.model(current => {
        expect(menuState(current)._tag).toBe('HeroPicker')
      }),
    ),
  )
})

describe('BACK and Esc', () => {
  it.effect(
    'the BACK button folds the card back into PLAY, focuses PLAY, and then it is gone',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyModel),
        openLobbyByKey,
        Story.messageIn(LobbyBinding, LobbyMessage.ClickedBackButton()),
        Story.Command.resolve(
          FocusHomeButton({ button: 'Play' }),
          Message.CompletedFocusHomeButton(),
        ),
        Story.model(current => {
          expect(current.lobby.status).toBe('Folding')
          expect(Phase.guards.Ready(current.phase)).toBe(true)
          expect(menuState(current)._tag).toBe('Home')
        }),
        foldLobby,
        Story.model(current => {
          expect(current.lobby.status).toBe('Closed')
        }),
      ),
  )

  it.effect('a tap outside the card folds it back as BACK does', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedBackdrop()),
      Story.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      Story.model(current => {
        expect(current.lobby.status).toBe('Folding')
        expect(menuState(current)._tag).toBe('Home')
      }),
      foldLobby,
    ),
  )

  it.effect('PLAY while the card folds away opens it again, and it stays', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      press('Escape'),
      Story.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      openLobbyByKey,
      foldLobby,
      Story.model(current => {
        expect(current.lobby.status).toBe('Open')
        expect(menuState(current)._tag).toBe('Lobby')
      }),
    ),
  )

  it.effect('Esc does the same, and keeps the picks it holds', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedModeButton({ mode: 'Endless' }),
      ),
      resolveFocusLobby(),
      press('Escape'),
      Story.Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      foldLobby,
      Story.model(current => {
        expect(menuState(current)._tag).toBe('Home')
        expect(current.home.mode).toBe('Endless')
      }),
    ),
  )
})

describe('the arrow keys', () => {
  it.effect('walk the lobby from START, wrap, and go back', () =>
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      openLobbyByKey,
      press('ArrowRight'),
      resolveFocusLobby('Back'),
      press('ArrowRight'),
      resolveFocusLobby('Hero'),
      press('ArrowLeft'),
      resolveFocusLobby('Back'),
      press('ArrowLeft'),
      resolveFocusLobby('Start'),
      press('ArrowLeft'),
      resolveFocusLobby('Glass'),
    ),
  )
})

describe('what skips the lobby', () => {
  const ended = modifyFields(readyModel, {
    difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
    calling: () => 'You',
    home: home => modifyFields(home, { mode: () => 'Endless' }),
    mode: () => RunMode.Endless(),
    phase: () => Phase.GameOver({ wave: 4 }),
    screenMs: () => RESTART_GRACE_MS,
  })

  it.effect('RETRY replays the same settings and never opens the lobby', () =>
    Story.story(
      APPLICATION,
      Story.given(ended),
      Story.message(Message.ClickedRetryButton()),
      throughIntro,
      Story.model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.difficulty.chosen).toBe('Hard')
        expect(current.lobby.status).toBe('Closed')
      }),
    ),
  )

  it.effect(
    'a brand new player in the practice gate starts the tutorial with PLAY',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(newPlayerCardSeen),
          Story.message(Message.ClickedPlayButton()),
          throughIntro,
          Story.model(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.lobby.status).toBe('Closed')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(newPlayerCardSeen),
          press('Enter'),
          throughIntro,
          Story.model(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.lobby.status).toBe('Closed')
          }),
        )
      }),
  )

  it.effect(
    'a new player who has not picked a difficulty is still asked, not sent to the lobby',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(initialModel, {
            difficultyCard: () => DifficultyCard.Unseen(),
          }),
        ),
        Story.message(Message.ClickedPlayButton()),
        showDialog(),
        Story.model(current => {
          expect(current.panel).toBe('Difficulty')
          expect(current.lobby.status).toBe('Closed')
        }),
      ),
  )

  it.effect('a player who has learned to move and shoot gets the lobby', () => {
    const learnedBoth = modifyFields(newPlayerCardSeen, {
      lessons: lessons =>
        modifyFields(lessons, {
          move: () => Lesson.Learned({ atMs: 0 }),
          fire: () => Lesson.Learned({ atMs: 0 }),
        }),
    })
    return Story.story(
      APPLICATION,
      Story.given(learnedBoth),
      startRunFromHome,
      Story.model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
      }),
    )
  })
})
