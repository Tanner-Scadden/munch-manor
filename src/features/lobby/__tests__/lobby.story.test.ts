import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { MenuState, isLobbyOpen, menuState } from '#app/menus/menuState.ts'
import { Message } from '#app/message.ts'
import { DifficultyCard, Lesson, Phase, RunMode } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { LobbyMessage } from '#features/lobby/message.ts'
import { RESTART_GRACE_MS } from '#shared/constants.ts'
import {
  heroesBoughtBy,
  newPlayerCardSeen,
  readyModel,
} from '#test/model.fixture.ts'
import {
  checkModel,
  foldLobby,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  send,
  startRunFromHome,
  storyOf,
  throughIntro,
} from '#test/testing.ts'
import { pointsForRank } from '#world/heroes/rank.ts'
import { focusOf } from '#world/party/party.ts'

import { focusesPlay } from './lobby.fixture.ts'

describe('PLAY opens the lobby', () => {
  it.effect('a tap on PLAY opens it, focuses START, and starts no run', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        send(Message.ClickedPlayButton()),
        resolveFocusLobby(),
        checkModel(current => {
          expect(current.lobby.status).toBe('Open')
          expect(isLobbyOpen(current)).toBe(true)
          expect(menuState(current)._tag).toBe('Lobby')
          expect(Phase.guards.Ready(current.phase)).toBe(true)
          expect(current.lobby.maybeFocus).toEqual(Option.some('Start'))
        }),
      )
    }),
  )

  it.effect(
    'Enter does the same, and the home keys that are not the lobby stop answering',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          openLobbyByKey,
          press('KeyV'),
          press('KeyO'),
          checkModel(current => {
            expect(MenuState.isAnyOf(['Lobby'])(menuState(current))).toBe(true)
            expect(current.rootDialog._tag).not.toBe('Hand')
            expect(current.rootDialog._tag).not.toBe('Profile')
          }),
        )
      }),
  )
})

describe('START plays what the lobby holds', () => {
  const chosen = UiStruct.evolve(readyModel, {
    rank: rank => ({ ...rank, earnedPoints: pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
    calling: () => 'Handyman',
    difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
    home: home => UiStruct.evolve(home, { mode: () => 'Endless' }),
  })

  it.effect(
    'the run has the chosen mode, difficulty, and hero, and the lobby is gone',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(chosen)
        s.pipe(
          send(Message.ClickedPlayButton()),
          resolveFocusLobby(),
          send(LobbyMessage.RequestedStartFromLobby()),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.mode).toEqual(RunMode.Endless())
            expect(current.difficulty.chosen).toBe('Hard')
            expect(focusOf(current).player.calling).toBe('Handyman')
            expect(current.lobby.status).toBe('Closed')
            expect(isLobbyOpen(current)).toBe(false)
          }),
        )
      }),
  )

  it.effect('picks made in the lobby are what START plays', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        send(LobbyMessage.PickedLobbyMode({ mode: 'Endless' })),
        resolveFocusLobby(),
        send(LobbyMessage.PickedLobbyDifficulty({ difficulty: 'Easy' })),
        resolveFocusLobby(),
        send(LobbyMessage.RequestedStartFromLobby()),
        checkModel(current => {
          expect(current.mode).toEqual(RunMode.Endless())
          expect(current.difficulty.chosen).toBe('Easy')
        }),
      )
    }),
  )

  it.effect(
    'Enter after a pick starts, since the pick moved focus to START',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          openLobbyByKey,
          send(LobbyMessage.PickedLobbyDifficulty({ difficulty: 'Hard' })),
          resolveFocusLobby(),
          press('Enter'),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.difficulty.chosen).toBe('Hard')
          }),
        )
      }),
  )

  it.effect('START does nothing when no lobby is open', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        send(LobbyMessage.RequestedStartFromLobby()),
        checkModel(current => {
          expect(Phase.guards.Ready(current.phase)).toBe(true)
        }),
      )
    }),
  )
})

describe('the hero card', () => {
  const ranked = UiStruct.evolve(readyModel, {
    rank: rank => ({ ...rank, earnedPoints: pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
  })

  it.effect(
    'opens the hero picker over the lobby, and a pick lands back in the lobby',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(ranked)
        s.pipe(
          openLobbyByKey,
          send(LobbyMessage.RequestedLobbyHeroPicker()),
          checkModel(current => {
            expect(menuState(current)._tag).toBe('HeroPicker')
            expect(current.lobby.status).toBe('Open')
          }),
          send(LobbyMessage.PickedLobbyHero({ calling: 'Handyman' })),
          checkModel(current => {
            expect(current.calling).toBe('Handyman')
            expect(menuState(current)._tag).toBe('Lobby')
          }),
        )
      }),
  )

  it.effect('Y opens it from the keyboard', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(ranked)
      s.pipe(
        openLobbyByKey,
        press('KeyY'),
        checkModel(current => {
          expect(menuState(current)._tag).toBe('HeroPicker')
        }),
      )
    }),
  )
})

describe('BACK and Esc', () => {
  it.effect(
    'the BACK button folds the card back into PLAY, focuses PLAY, and then it is gone',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(readyModel)
        s.pipe(
          openLobbyByKey,
          send(LobbyMessage.RequestedLeaveLobby()),
          focusesPlay,
          checkModel(current => {
            expect(current.lobby.status).toBe('Folding')
            expect(Phase.guards.Ready(current.phase)).toBe(true)
            expect(menuState(current)._tag).toBe('Home')
          }),
          foldLobby,
          checkModel(current => {
            expect(current.lobby.status).toBe('Closed')
          }),
        )
      }),
  )

  it.effect('a tap outside the card folds it back as BACK does', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        send(LobbyMessage.RequestedLeaveLobby()),
        focusesPlay,
        checkModel(current => {
          expect(current.lobby.status).toBe('Folding')
          expect(menuState(current)._tag).toBe('Home')
        }),
        foldLobby,
      )
    }),
  )

  it.effect('PLAY while the card folds away opens it again, and it stays', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        press('Escape'),
        focusesPlay,
        openLobbyByKey,
        foldLobby,
        checkModel(current => {
          expect(current.lobby.status).toBe('Open')
          expect(menuState(current)._tag).toBe('Lobby')
        }),
      )
    }),
  )

  it.effect('Esc does the same, and keeps the picks it holds', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByKey,
        send(LobbyMessage.PickedLobbyMode({ mode: 'Endless' })),
        resolveFocusLobby(),
        press('Escape'),
        focusesPlay,
        foldLobby,
        checkModel(current => {
          expect(menuState(current)._tag).toBe('Home')
          expect(current.home.mode).toBe('Endless')
        }),
      )
    }),
  )
})

describe('the arrow keys', () => {
  it.effect('walk the lobby from START, wrap, and go back', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
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
      )
    }),
  )
})

describe('what skips the lobby', () => {
  const ended = UiStruct.evolve(readyModel, {
    difficulty: () => ({ chosen: 'Hard', nightmare: 'Locked' }),
    calling: () => 'You',
    home: home => UiStruct.evolve(home, { mode: () => 'Endless' }),
    mode: () => RunMode.Endless(),
    phase: () => Phase.GameOver({ wave: 4 }),
    screenMs: () => RESTART_GRACE_MS,
  })

  it.effect('RETRY replays the same settings and never opens the lobby', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(ended)
      s.pipe(
        send(Message.ClickedRetryButton()),
        throughIntro,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
          expect(current.mode).toEqual(RunMode.Endless())
          expect(current.difficulty.chosen).toBe('Hard')
          expect(current.lobby.status).toBe('Closed')
        }),
      )
    }),
  )

  it.effect(
    'a brand new player in the practice gate starts the tutorial with PLAY',
    () =>
      Effect.gen(function* () {
        const byTap = yield* storyOf(newPlayerCardSeen)
        byTap.pipe(
          send(Message.ClickedPlayButton()),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.lobby.status).toBe('Closed')
          }),
        )
        const byKey = yield* storyOf(newPlayerCardSeen)
        byKey.pipe(
          press('Enter'),
          throughIntro,
          checkModel(current => {
            expect(Phase.guards.Preparation(current.phase)).toBe(true)
            expect(current.lobby.status).toBe('Closed')
          }),
        )
      }),
  )

  it.effect(
    'a new player who has not picked a difficulty is still asked, not sent to the lobby',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(initialModel, {
            difficultyCard: () => DifficultyCard.Unseen,
          }),
        )
        s.pipe(
          send(Message.ClickedPlayButton()),
          checkModel(current => {
            expect(current.panel).toBe('Difficulty')
            expect(current.lobby.status).toBe('Closed')
          }),
        )
      }),
  )

  it.effect('a player who has learned to move and shoot gets the lobby', () => {
    const learnedBoth = UiStruct.evolve(newPlayerCardSeen, {
      lessons: lessons =>
        UiStruct.evolve(lessons, {
          move: () => Lesson.Learned({ atMs: 0 }),
          fire: () => Lesson.Learned({ atMs: 0 }),
        }),
    })
    return Effect.gen(function* () {
      const s = yield* storyOf(learnedBoth)
      s.pipe(
        startRunFromHome,
        checkModel(current => {
          expect(Phase.guards.Preparation(current.phase)).toBe(true)
        }),
      )
    })
  })
})
