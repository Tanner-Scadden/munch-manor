import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { MenuState, isLobbyOpen, menuState } from './menuState'
import { Message } from './message'
import { DifficultyCard, Lesson, Phase, RunMode, initialModel } from './model'
import { heroesBoughtBy, newPlayerCardSeen, readyModel } from './model.fixture'
import { pointsForRank } from './rank'
import {
  closeDialog,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  showDialog,
  startRunFromHome,
} from './testing'
import { FocusHomeButton } from './update/home'
import { FocusLobbyControl } from './update/lobby'

// The single player lobby (src/lobby.ts, src/update/lobby.ts): PLAY opens
// it, START plays what it holds, and BACK and Esc go home.

describe('PLAY opens the lobby', () => {
  test('a tap on PLAY opens it, focuses START, and starts no run', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedPlayButton()),
      Command.resolve(
        FocusLobbyControl({ control: 'Start' }),
        Message.CompletedFocusLobbyControl(),
      ),
      model(current => {
        expect(current.home.lobby).toBe('Open')
        expect(isLobbyOpen(current)).toBe(true)
        expect(menuState(current)._tag).toBe('Lobby')
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(current.home.maybeLobbyFocus).toEqual(Option.some('Start'))
      }),
    )
  })

  test('Enter does the same, and the home keys that are not the lobby stop answering', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      press('KeyV'),
      press('KeyO'),
      model(current => {
        expect(MenuState.isAnyOf(['Lobby'])(menuState(current))).toBe(true)
        expect(current.handDialog.isOpen).toBe(false)
        expect(current.profileDialog.isOpen).toBe(false)
      }),
    )
  })
})

describe('START plays what the lobby holds', () => {
  const chosen = modifyFields(readyModel, {
    rank: rank => ({ ...rank, earnedPoints: pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
    calling: () => 'Handyman',
    difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
    home: home => modifyFields(home, { mode: () => 'Endless' }),
  })

  test('the run has the chosen mode, difficulty, and hero, and the lobby is gone', () => {
    story(
      update,
      given(chosen),
      message(Message.ClickedPlayButton()),
      resolveFocusLobby(),
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.difficulty.chosen).toBe('Hard')
        expect(current.player.calling).toBe('Handyman')
        expect(current.home.lobby).toBe('Closed')
        expect(isLobbyOpen(current)).toBe(false)
      }),
    )
  })

  test('picks made in the lobby are what START plays', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      message(Message.ClickedLobbyModeButton({ mode: 'Endless' })),
      resolveFocusLobby(),
      message(Message.ClickedLobbyDifficultyButton({ difficulty: 'Easy' })),
      resolveFocusLobby(),
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.difficulty.chosen).toBe('Easy')
      }),
    )
  })

  test('Enter after a pick starts, since the pick moved focus to START', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      message(Message.ClickedLobbyDifficultyButton({ difficulty: 'Hard' })),
      resolveFocusLobby(),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.difficulty.chosen).toBe('Hard')
      }),
    )
  })

  test('START does nothing when no lobby is open', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(Phase.guards.Ready(current.phase)).toBe(true)
      }),
    )
  })
})

describe('the hero card', () => {
  const ranked = modifyFields(readyModel, {
    rank: rank => ({ ...rank, earnedPoints: pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
  })

  test('opens the hero picker over the lobby, and a pick lands back in the lobby', () => {
    story(
      update,
      given(ranked),
      openLobbyByKey,
      message(Message.ClickedLobbyHeroButton()),
      showDialog(),
      model(current => {
        expect(menuState(current)._tag).toBe('Panel')
        expect(current.panel).toBe('Calling')
        expect(current.home.lobby).toBe('Open')
      }),
      message(Message.ClickedCallingCardButton({ calling: 'Handyman' })),
      closeDialog(),
      model(current => {
        expect(current.calling).toBe('Handyman')
        expect(menuState(current)._tag).toBe('Lobby')
      }),
    )
  })

  test('Y opens it from the keyboard', () => {
    story(
      update,
      given(ranked),
      openLobbyByKey,
      press('KeyY'),
      showDialog(),
      model(current => {
        expect(current.panel).toBe('Calling')
      }),
    )
  })
})

describe('BACK and Esc', () => {
  test('the BACK button closes the lobby and focuses PLAY', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      message(Message.ClickedLobbyBackButton()),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      model(current => {
        expect(current.home.lobby).toBe('Closed')
        expect(Phase.guards.Ready(current.phase)).toBe(true)
        expect(menuState(current)._tag).toBe('Home')
      }),
    )
  })

  test('Esc does the same, and keeps the picks it holds', () => {
    story(
      update,
      given(readyModel),
      openLobbyByKey,
      message(Message.ClickedLobbyModeButton({ mode: 'Endless' })),
      resolveFocusLobby(),
      press('Escape'),
      Command.resolve(
        FocusHomeButton({ button: 'Play' }),
        Message.CompletedFocusHomeButton(),
      ),
      model(current => {
        expect(menuState(current)._tag).toBe('Home')
        expect(current.home.mode).toBe('Endless')
      }),
    )
  })
})

describe('the arrow keys', () => {
  test('walk the lobby from START, wrap, and go back', () => {
    story(
      update,
      given(readyModel),
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
      resolveFocusLobby('Nightmare'),
    )
  })
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

  test('RETRY replays the same settings and never opens the lobby', () => {
    story(
      update,
      given(ended),
      message(Message.ClickedRetryButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.difficulty.chosen).toBe('Hard')
        expect(current.home.lobby).toBe('Closed')
      }),
    )
  })

  test('KEEP GOING from Victory skips it too', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.Victory(),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      message(Message.ClickedKeepGoingButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.mode).toEqual(RunMode.Endless())
        expect(current.home.lobby).toBe('Closed')
      }),
    )
  })

  test('a brand new player in the practice gate starts the tutorial with PLAY', () => {
    story(
      update,
      given(newPlayerCardSeen),
      message(Message.ClickedPlayButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.home.lobby).toBe('Closed')
      }),
    )
    story(
      update,
      given(newPlayerCardSeen),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.home.lobby).toBe('Closed')
      }),
    )
  })

  test('a new player who has not picked a difficulty is still asked, not sent to the lobby', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          difficultyCard: () => DifficultyCard.Unseen(),
        }),
      ),
      message(Message.ClickedPlayButton()),
      showDialog(),
      model(current => {
        expect(current.panel).toBe('Difficulty')
        expect(current.home.lobby).toBe('Closed')
      }),
    )
  })

  test('a player who has learned to move and shoot gets the lobby', () => {
    const learnedBoth = modifyFields(newPlayerCardSeen, {
      lessons: lessons =>
        modifyFields(lessons, {
          move: () => Lesson.Learned({ atMs: 0 }),
          fire: () => Lesson.Learned({ atMs: 0 }),
        }),
    })
    story(
      update,
      given(learnedBoth),
      startRunFromHome,
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
      }),
    )
  })
})
