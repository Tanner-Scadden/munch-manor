import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model } from '../../../app/model'
import { FocusHomeButton } from '../../../app/update/home'
import { FocusLobbyControl } from '../../../app/update/lobby'
import { defaultAppearance } from '../../../domain/clientSchema'
import { heroesBoughtBy, readyModel } from '../../../test/model.fixture'
import {
  type StoryStep,
  checkModel,
  expectNoCommand,
  foldLobby,
  openLobbyByTap,
  press,
  resolveFocusLobby,
  send,
  storyOf,
} from '../../../test/testing'
import { pointsForRank } from '../../../world/heroes/rank'
import { noModifiers } from '../../../world/run/modifiers'
import { Lobby } from '../block'
import {
  Events,
  Message as LobbyComponentMessage,
  LobbyMessage,
} from '../message'
import {
  type LobbyPicks,
  type LobbyProps,
  initialLobby,
  isHeroPickerUp,
  openedLobby,
} from '../model'

// The single player lobby. The Lobby component holds no state: each tap
// comes up as an event. The root judges and makes each one
// (src/app/update/lobby.ts): it opens on PLAY, makes each pick and focuses
// START, opens the hero picker in its Dialog, and plays the hero worn. The
// root's side of starting a run, the bot rolled, and the hero bought is in
// lobby.story.test.ts.

const PICKS: LobbyPicks = {
  mode: 'Campaign',
  difficulty: { chosen: 'Normal', nightmare: 'Locked' },
  modifiers: noModifiers,
  easyBreakSeconds: 0,
  dareMark: 0,
  bestMark: 0,
  bots: [],
  botSeats: 3,
  lock: 'Open',
}

const PROPS: LobbyProps = {
  lobby: openedLobby(initialLobby),
  picks: PICKS,
  name: 'Pal',
  look: defaultAppearance,
  rank: 1,
  calling: 'You',
  isHeroNew: false,
  bought: [],
  bones: 0,
  fresh: [],
  isKeyboard: true,
}

// NOTE: each of the component's Messages and the event it raises for the
// root, one row each.
const TAPS: ReadonlyArray<readonly [LobbyComponentMessage, Events]> = [
  [LobbyComponentMessage.ClickedBackButton(), Events.RequestedLeave()],
  [LobbyComponentMessage.ClickedBackdrop(), Events.RequestedLeave()],
  [LobbyComponentMessage.ClickedStartButton(), Events.RequestedStart()],
  [LobbyComponentMessage.ClickedHeroButton(), Events.RequestedHeroPicker()],
  [LobbyComponentMessage.ClickedAddBotButton(), Events.RequestedAddBot()],
  [
    LobbyComponentMessage.ClickedDropBotButton({ index: 1 }),
    Events.RequestedDropBot({ index: 1 }),
  ],
  [
    LobbyComponentMessage.ClickedBotHeroButton({ index: 0 }),
    Events.RequestedBotHeroPicker({ index: 0 }),
  ],
  [
    LobbyComponentMessage.ClickedModeButton({ mode: 'Endless' }),
    Events.PickedMode({ mode: 'Endless' }),
  ],
  [
    LobbyComponentMessage.ClickedDifficultyButton({ difficulty: 'Hard' }),
    Events.PickedDifficulty({ difficulty: 'Hard' }),
  ],
  [
    LobbyComponentMessage.ClickedModifierButton({ modifier: 'Glass' }),
    Events.ToggledModifier({ modifier: 'Glass' }),
  ],
  [LobbyComponentMessage.ClickedEasyBreakButton(), Events.SteppedEasyBreak()],
  [LobbyComponentMessage.ClickedMarkButton(), Events.SteppedDareMark()],
  [
    LobbyComponentMessage.FocusedControl({ control: 'Mark' }),
    Events.FocusedControl({ control: 'Mark' }),
  ],
  [LobbyComponentMessage.BlurredControl(), Events.BlurredControl()],
  [
    LobbyComponentMessage.PickedHeroCard({ calling: 'Handyman' }),
    Events.PickedHero({ calling: 'Handyman' }),
  ],
  [
    LobbyComponentMessage.RequestedBuyHero({ calling: 'Handyman' }),
    Events.RequestedBuyHero({ calling: 'Handyman' }),
  ],
  [
    LobbyComponentMessage.RequestedCloseHeroPicker(),
    Events.RequestedCloseHeroPicker(),
  ],
]

describe('the Lobby component', () => {
  it.effect('says each tap for the root to judge', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Lobby, PROPS)
      Array.forEach(TAPS, ([message, event]) => {
        s.send(message).emitted(event)
      })
    }),
  )
})

// THE ROOT'S RULES

const ranked = (model: Model): Model =>
  UiStruct.evolve(model, {
    rank: UiStruct.evolve({ earnedPoints: () => pointsForRank(3) }),
    boughtCosmetics: () => heroesBoughtBy(3),
  })

const withBot = (model: Model): Model =>
  UiStruct.evolve(model, {
    home: UiStruct.evolve({
      bots: () => [
        { name: 'Gravy Dave', calling: 'You', look: defaultAppearance },
      ],
    }),
  })

const onDifficulty =
  (chosen: 'Easy' | 'Normal' | 'Hard') =>
  (model: Model): Model =>
    UiStruct.evolve(model, {
      difficulty: () => ({ chosen, nightmare: 'Locked' }),
    })

// NOTE: a pick puts focus on START, so Enter plays next.
const focusesStart: StoryStep = s =>
  s
    .expectExact(FocusLobbyControl.make({ control: 'Start' }))
    .pipe(resolveFocusLobby())

const lobbyOf = (check: (model: Model) => void): StoryStep => checkModel(check)

describe("the lobby's rules on the root", () => {
  it.effect('opens with START focused', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        send(Message.ClickedPlayButton()),
        focusesStart,
        lobbyOf(model => {
          expect(model.lobby.status).toBe('Open')
          expect(model.lobby.maybeFocus).toEqual(Option.some('Start'))
        }),
      )
    }),
  )

  it.effect('a mode tile makes the mode, and focuses START', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.PickedLobbyMode({ mode: 'Endless' })),
        focusesStart,
        lobbyOf(model => {
          expect(model.home.mode).toBe('Endless')
        }),
      )
    }),
  )

  it.effect('a locked Nightmare changes nothing; X steps past it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.PickedLobbyDifficulty({ difficulty: 'Nightmare' })),
        expectNoCommand,
        lobbyOf(model => {
          expect(model.difficulty.chosen).toBe('Normal')
        }),
        press('KeyX'),
        focusesStart,
        lobbyOf(model => {
          expect(model.difficulty.chosen).toBe('Hard')
        }),
      )
    }),
  )

  it.effect('Friendly Fire waits for a bot in the crew', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.ToggledLobbyModifier({ modifier: 'FriendlyFire' })),
        send(LobbyMessage.ToggledLobbyModifier({ modifier: 'Glass' })),
        lobbyOf(model => {
          expect(model.modifiers.friendlyFire).toBe(false)
          expect(model.modifiers.glass).toBe(true)
        }),
      )
    }),
  )

  it.effect('with a bot seated, Friendly Fire turns on', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withBot(readyModel))
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.ToggledLobbyModifier({ modifier: 'FriendlyFire' })),
        lobbyOf(model => {
          expect(model.modifiers.friendlyFire).toBe(true)
        }),
      )
    }),
  )

  // NOTE: owner, 2026-11-12: on Dare the lobby picks the break's clock,
  // none first; above Dare there is no pill to press.
  it.effect('on Dare the break clock steps to its next choice', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onDifficulty('Easy')(readyModel))
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.SteppedLobbyEasyBreak()),
        lobbyOf(model => {
          expect(model.easyBreakSeconds).toBe(60)
        }),
      )
    }),
  )

  it.effect('on Dare the break clock goes round from 20 s to none', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(onDifficulty('Easy')(readyModel), {
          easyBreakSeconds: () => 20,
        }),
      )
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.SteppedLobbyEasyBreak()),
        lobbyOf(model => {
          expect(model.easyBreakSeconds).toBe(0)
        }),
      )
    }),
  )

  it.effect('above Dare the break clock asks nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.SteppedLobbyEasyBreak()),
        lobbyOf(model => {
          expect(model.easyBreakSeconds).toBe(readyModel.easyBreakSeconds)
        }),
      )
    }),
  )

  // NOTE: the dare ladder (GAME_DESIGN.md, "The dare ladder"): the mark's
  // pick steps through the marks opened, round to none, and asks nothing
  // before an escape opens mark 1.
  const markedAt = (dareMark: number, best: number): Model =>
    UiStruct.evolve(readyModel, {
      dareMark: () => dareMark,
      dareMarks: marks => ({ ...marks, Normal: best }),
    })

  it.effect('the mark steps to the next opened, round to none', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(markedAt(2, 3))
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.SteppedLobbyDareMark()),
        lobbyOf(model => {
          expect(model.dareMark).toBe(3)
        }),
      )
    }),
  )

  it.effect('past the best mark opened, the pick goes back to none', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(markedAt(3, 3))
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.SteppedLobbyDareMark()),
        lobbyOf(model => {
          expect(model.dareMark).toBe(0)
        }),
      )
    }),
  )

  it.effect('with no mark opened, the mark asks nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.SteppedLobbyDareMark()),
        lobbyOf(model => {
          expect(model.dareMark).toBe(0)
        }),
      )
    }),
  )

  it.effect('a modifier the mark holds is locked on', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(markedAt(2, 2))
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.ToggledLobbyModifier({ modifier: 'Broke' })),
        lobbyOf(model => {
          expect(model.modifiers.broke).toBe(false)
        }),
        send(LobbyMessage.ToggledLobbyModifier({ modifier: 'Glass' })),
        lobbyOf(model => {
          expect(model.modifiers.glass).toBe(true)
        }),
      )
    }),
  )

  it.effect('+ BOT and B seat a bot each, and focus START', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.RequestedAddLobbyBot()),
        focusesStart,
        press('KeyB'),
        focusesStart,
        lobbyOf(model => {
          expect(model.home.bots.length).toBe(2)
        }),
      )
    }),
  )

  it.effect(
    'Enter starts, closing the lobby at once, and Esc goes back, folding it away first',
    () =>
      Effect.gen(function* () {
        const ran = yield* storyOf(readyModel)
        ran.pipe(
          openLobbyByTap,
          press('Enter'),
          lobbyOf(model => {
            expect(model.lobby.status).toBe('Closed')
          }),
        )
        const left = yield* storyOf(readyModel)
        left.pipe(
          openLobbyByTap,
          press('Escape'),
          lobbyOf(model => {
            expect(model.lobby.status).toBe('Folding')
          }),
          s => s.resolve(FocusHomeButton, Component.noop),

          foldLobby,
          lobbyOf(model => {
            expect(model.lobby.status).toBe('Closed')
          }),
        )
      }),
  )

  it.effect(
    'the hero card opens the picker in its Dialog, and a hero worn closes it',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(ranked(readyModel))
        s.pipe(
          openLobbyByTap,
          send(LobbyMessage.RequestedLobbyHeroPicker()),
          lobbyOf(model => {
            expect(isHeroPickerUp(model.lobby)).toBe(true)
          }),
          press('Enter'),
          lobbyOf(model => {
            expect(model.lobby.status).toBe('Open')
            expect(isHeroPickerUp(model.lobby)).toBe(true)
          }),
          send(LobbyMessage.PickedLobbyHero({ calling: 'Handyman' })),
          lobbyOf(model => {
            expect(model.calling).toBe('Handyman')
            expect(isHeroPickerUp(model.lobby)).toBe(false)
            expect(model.lobby.status).toBe('Open')
          }),
        )
      }),
  )

  it.effect(
    "a bot's card chooses for that bot, and BUY only ends its try-on",
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(withBot(ranked(readyModel)))
        s.pipe(
          openLobbyByTap,
          send(LobbyMessage.RequestedLobbyBotHeroPicker({ index: 0 })),
          send(LobbyMessage.RequestedBuyLobbyHero({ calling: 'Handyman' })),
          lobbyOf(model => {
            expect(model.lobby.maybeTrying).toEqual(Option.none())
            expect(model.lobby.maybePickingBot).toEqual(Option.some(0))
          }),
          send(LobbyMessage.PickedLobbyHero({ calling: 'Handyman' })),
          lobbyOf(model => {
            expect(
              Option.map(Array.head(model.home.bots), bot => bot.calling),
            ).toEqual(Option.some('Handyman'))
            expect(isHeroPickerUp(model.lobby)).toBe(false)
          }),
        )
      }),
  )

  it.effect('the Dialog closing closes the picker and forgets the bot', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withBot(readyModel))
      s.pipe(
        openLobbyByTap,
        send(LobbyMessage.RequestedLobbyBotHeroPicker({ index: 0 })),
        send(LobbyMessage.RequestedCloseLobbyHeroPicker()),
        lobbyOf(model => {
          expect(model.lobby.isHeroPickerOpen).toBe(false)
          expect(model.lobby.maybePickingBot).toEqual(Option.none())
          expect(isHeroPickerUp(model.lobby)).toBe(false)
        }),
      )
    }),
  )
})
