import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { cameraOf } from './camera'
import { FIXED_STEP_MS, PREPARATION_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  BreakClock,
  DebutCard,
  DifficultyCard,
  Lesson,
  type Model,
  Phase,
  Reload,
  RunMode,
  initialModel,
} from './model'
import { home } from './model.fixture'
import {
  DEBUT_CARD_MIN_MS,
  DEBUT_CARD_MS,
  isCountdownBeckoning,
  shownHints,
} from './onboarding'
import { maybeBubbleKind } from './stallBubble'
import { holdingFirst, showDialog, tap, tick, ticks } from './testing'
import { SetFullscreen } from './update/fullscreen'
import { ShowInstallPrompt } from './update/home'
import { keepGoing } from './update/run'
import { STARTING_PISTOL } from './weapons'

const TICK_MS = 50
// NOTE: a 50 ms frame is three 60 Hz ticks; the moment a wave clears is
// checked after a single tick, before the break's clock has run.

const clearingWave = (wave: number): Model =>
  modifyFields(home, {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
  })

const isBreak = (current: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(current.phase)

const isFighting = (current: Model): boolean =>
  Phase.isAnyOf(['Wave'])(current.phase)

const breakClock = (current: Model): Option.Option<BreakClock> =>
  Phase.match(current.phase, {
    Ready: () => Option.none(),
    Preparation: ({ clock }) => Option.some(clock),
    Wave: () => Option.none(),
    Paused: () => Option.none(),
    Victory: () => Option.none(),
    GameOver: () => Option.none(),
  })

const bubble = (current: Model) => maybeBubbleKind(current, cameraOf(current))
const BREAK_TICKS = Math.ceil(PREPARATION_MS / TICK_MS) + 10

describe('the first break waits', () => {
  test('the break before wave 2 has no countdown and waits for START WAVE', () => {
    story(
      update,
      given(clearingWave(1)),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(isBreak(current)).toBe(true)
        expect(breakClock(current)).toEqual(
          Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
        )
      }),
      ...ticks(BREAK_TICKS, TICK_MS),
      model(current => {
        expect(isBreak(current)).toBe(true)
        expect(shownHints(current)).toEqual([])
        expect(isCountdownBeckoning(current)).toBe(false)
        expect(bubble(current)).toEqual(Option.some('Traps'))
      }),
      tap('Enter'),
      model(current => {
        expect(isFighting(current)).toBe(true)
      }),
    )
  })

  test('the break before wave 3 counts down once the fridge is tried, with the heads-up shown once', () => {
    story(
      update,
      given(
        modifyFields(clearingWave(2), {
          fridge: fridge => modifyFields(fridge, { pulls: () => 1 }),
        }),
      ),
      tick(TICK_MS),
      model(current => {
        expect(breakClock(current)).toEqual(Option.some(BreakClock.Counting()))
        expect(isCountdownBeckoning(current)).toBe(true)
      }),
      ...ticks(BREAK_TICKS, TICK_MS),
      model(current => {
        expect(isFighting(current)).toBe(true)
        expect(current.lessons.timedBreaks._tag).toBe('Learned')
      }),
    )
    const afterHeadsUp = update(
      modifyFields(clearingWave(3), {
        lessons: lessons =>
          modifyFields(lessons, {
            timedBreaks: () => Lesson.Learned({ atMs: 0 }),
          }),
      }),
      Message.TickedFrame({ deltaTime: TICK_MS }),
    ).model
    expect(isBreak(afterHeadsUp)).toBe(true)
    expect(isCountdownBeckoning(afterHeadsUp)).toBe(false)
  })

  test('endless keeps the same rule, and Keep going is timed', () => {
    story(
      update,
      given(
        modifyFields(clearingWave(1), {
          mode: () => RunMode.Endless(),
        }),
      ),
      tick(FIXED_STEP_MS),
      model(current => {
        expect(breakClock(current)).toEqual(
          Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
        )
      }),
    )
    const keptGoing = keepGoing(
      modifyFields(home, { phase: () => Phase.Victory() }),
    )
    expect(breakClock(keptGoing)).toEqual(Option.some(BreakClock.Counting()))
  })
})

describe('the new zombie card', () => {
  const carded: Model = modifyFields(home, {
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
  })

  test('stays up 5.5 seconds and cannot be skipped in its first 1.5', () => {
    expect(DEBUT_CARD_MS).toBe(3000)
    expect(DEBUT_CARD_MIN_MS).toBe(600)
    story(
      update,
      given(carded),
      ...ticks(DEBUT_CARD_MIN_MS / TICK_MS - 1, TICK_MS),
      tap('Enter'),
      message(Message.ClickedDebutCardButton()),
      model(current => {
        expect(current.debutCard._tag).toBe('Showing')
        expect(current.player.x).toBe(home.player.x)
      }),
      tick(TICK_MS),
      tap('Enter'),
      model(current => {
        expect(current.debutCard).toEqual(DebutCard.Hidden())
      }),
    )
    story(
      update,
      given(carded),
      ...ticks(DEBUT_CARD_MS / TICK_MS - 1, TICK_MS),
      model(current => {
        expect(current.debutCard._tag).toBe('Showing')
      }),
      tick(TICK_MS),
      model(current => {
        expect(current.debutCard).toEqual(DebutCard.Hidden())
      }),
    )
  })
})

describe('gun slots on touch', () => {
  const carrying: Model = modifyFields(home, {
    lastDevice: () => 'Touch',
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
    player: player =>
      modifyFields(player, {
        arsenal: () =>
          holdingFirst(
            { kind: 'Smg', rounds: 90, loaded: 30, tier: 0 },
            { ...STARTING_PISTOL, loaded: 2 },
          ),
      }),
  })

  test('a tap on the held gun reloads it, a tap on the other swaps', () => {
    story(
      update,
      given(carrying),
      message(Message.ClickedGunSlot({ slot: 'First' })),
      model(current => {
        expect(Reload.isAnyOf(['Reloading'])(current.player.reload)).toBe(true)
        expect(current.player.arsenal._tag).toBe('HoldingFirst')
      }),
      message(Message.ClickedGunSlot({ slot: 'Second' })),
      model(current => {
        expect(current.player.arsenal._tag).toBe('HoldingSecond')
        expect(Reload.isAnyOf(['Ready'])(current.player.reload)).toBe(true)
      }),
    )
  })
})

describe('full screen', () => {
  test('the button asks for full screen, and a refusal changes nothing', () => {
    story(
      update,
      given(modifyFields(initialModel, { screenFit: () => 'Fullscreen' })),
      message(Message.ClickedFullscreenButton()),
      Command.expectExact(SetFullscreen({ fullscreen: 'On' })),
      Command.resolve(
        SetFullscreen,
        Message.FailedSetFullscreen({ reason: 'Permission denied' }),
      ),
      model(current => {
        expect(current.fullscreen).toBe('Off')
      }),
      message(Message.ClickedFullscreenButton()),
      Command.resolve(
        SetFullscreen,
        Message.CompletedSetFullscreen({ fullscreen: 'On' }),
      ),
      model(current => {
        expect(current.fullscreen).toBe('On')
      }),
      message(Message.ClickedFullscreenButton()),
      Command.expectExact(SetFullscreen({ fullscreen: 'Off' })),
      Command.resolve(
        SetFullscreen,
        Message.CompletedSetFullscreen({ fullscreen: 'Off' }),
      ),
      message(Message.ChangedFullscreen({ fullscreen: 'On' })),
      model(current => {
        expect(current.fullscreen).toBe('On')
      }),
    )
  })
})

describe('the install tile', () => {
  test('on Chrome, a tap shows the browser install prompt and stops the pulse', () => {
    story(
      update,
      given(modifyFields(initialModel, { screenFit: () => 'Fullscreen' })),
      message(Message.ChangedInstallOffer({ installOffer: 'Ready' })),
      model(current => {
        expect(current.homeScreenTip).toBe('Unseen')
      }),
      message(Message.ClickedInstallButton()),
      Command.expectExact(ShowInstallPrompt),
      model(current => {
        expect(current.homeScreenTip).toBe('Dismissed')
        expect(current.homeScreenSteps.isOpen).toBe(false)
      }),
      Command.resolve(
        ShowInstallPrompt,
        Message.CompletedShowInstallPrompt({ outcome: 'Accepted' }),
      ),
      model(current => {
        expect(current.installOffer).toBe('Installed')
      }),
    )
  })

  test('a turned down prompt is spent, and the tile goes until Chrome offers again', () => {
    story(
      update,
      given(modifyFields(initialModel, { installOffer: () => 'Ready' })),
      message(Message.ClickedInstallButton()),
      Command.resolve(
        ShowInstallPrompt,
        Message.CompletedShowInstallPrompt({ outcome: 'Dismissed' }),
      ),
      model(current => {
        expect(current.installOffer).toBe('None')
      }),
      message(Message.ClickedInstallButton()),
      Command.expectNone(),
    )
  })

  test('on an iPhone, a tap opens the picture guide', () => {
    story(
      update,
      given(modifyFields(initialModel, { screenFit: () => 'HomeScreen' })),
      message(Message.ClickedInstallButton()),
      model(current => {
        expect(current.homeScreenSteps.isOpen).toBe(true)
        expect(current.homeScreenTip).toBe('Dismissed')
      }),
      showDialog(),
    )
  })

  test('the pulse outlives a run until the tile is used', () => {
    story(
      update,
      given(
        modifyFields(initialModel, {
          screenFit: () => 'HomeScreen',
          difficultyCard: () => DifficultyCard.Seen(),
        }),
      ),
      tap('Enter'),
      model(current => {
        expect(current.homeScreenTip).toBe('Unseen')
      }),
    )
  })

  test('the installed Home Screen app is told apart from the browser', () => {
    story(
      update,
      given(initialModel),
      message(Message.CompletedDetectScreenFit({ screenFit: 'Installed' })),
      model(current => {
        expect(current.screenFit).toBe('Installed')
      }),
    )
  })
})
