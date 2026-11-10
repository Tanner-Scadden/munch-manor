import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  BreakClock,
  DebutCard,
  type Difficulty,
  DifficultyCard,
  Lesson,
  type Model,
  Phase,
  Reload,
  RunMode,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { SetFullscreen } from '../../../app/update/fullscreen'
import { ShowInstallPrompt } from '../../../app/update/home'
import {
  DEBUT_CARD_MIN_MS,
  DEBUT_CARD_MS,
  isCountdownBeckoning,
  shownHints,
} from '../../../features/onboarding/onboarding'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { home, onHard, pastTimedBreaks } from '../../../test/model.fixture'
import {
  APPLICATION,
  showDialog,
  tap,
  tick,
  ticks,
} from '../../../test/testing'
import { STARTING_PISTOL } from '../../gear/weapons'
import { focusOf, modifyFocus } from '../../party/party'
import { Arsenal } from '../../schema/worldSchema'

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
    Arriving: () => Option.none(),
    Preparation: ({ clock }) => Option.some(clock),
    Wave: () => Option.none(),
    Paused: () => Option.none(),
    Escaped: () => Option.none(),
    GameOver: () => Option.none(),
  })

const BREAK_TICKS = Math.ceil(PREPARATION_MS / TICK_MS) + 10

describe('the first break waits', () => {
  it.effect(
    'the break before wave 2 has no countdown and waits for START WAVE',
    () =>
      Story.story(
        APPLICATION,
        Story.given(clearingWave(1)),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(isBreak(current)).toBe(true)
          expect(breakClock(current)).toEqual(
            Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
          )
        }),
        ...ticks(BREAK_TICKS, TICK_MS),
        Story.model(current => {
          expect(isBreak(current)).toBe(true)
          expect(shownHints(current)).toEqual([])
          expect(isCountdownBeckoning(current)).toBe(false)
        }),
        tap('Enter'),
        Story.model(current => {
          expect(isFighting(current)).toBe(true)
        }),
      ),
  )

  it.effect(
    'the break before wave 3 counts down once the fridge is tried, with the heads-up shown once',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(
            onHard(
              modifyFields(clearingWave(2), {
                fridge: fridge => modifyFields(fridge, { pulls: () => 1 }),
              }),
            ),
          ),
          tick(TICK_MS),
          Story.model(current => {
            expect(breakClock(current)).toEqual(
              Option.some(BreakClock.Counting()),
            )
            expect(isCountdownBeckoning(current)).toBe(true)
          }),
          ...ticks(BREAK_TICKS, TICK_MS),
          Story.model(current => {
            expect(isFighting(current)).toBe(true)
            expect(current.lessons.timedBreaks._tag).toBe('Learned')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(clearingWave(3), {
              lessons: lessons =>
                modifyFields(lessons, {
                  timedBreaks: () => Lesson.Learned({ atMs: 0 }),
                }),
            }),
          ),
          tick(TICK_MS),
          Story.model(afterHeadsUp => {
            expect(isBreak(afterHeadsUp)).toBe(true)
            expect(isCountdownBeckoning(afterHeadsUp)).toBe(false)
          }),
        )
      }),
  )

  it.effect('endless keeps the same rule', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(clearingWave(1), {
          mode: () => RunMode.Endless(),
        }),
      ),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(breakClock(current)).toEqual(
          Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
        )
      }),
    ),
  )
})

// NOTE: owner, 2026-11-01: "don't want wave timers on easy/medium. Too much."
describe('the break clock by difficulty', () => {
  const clearingLaterWave = (difficulty: Difficulty): Model =>
    modifyFields(pastTimedBreaks(clearingWave(4)), {
      difficulty: setting =>
        modifyFields(setting, { chosen: () => difficulty }),
    })

  it.effect.each(['Easy', 'Normal'] as const)(
    '%s has no countdown, and the wave waits for READY',
    difficulty =>
      Story.story(
        APPLICATION,
        Story.given(clearingLaterWave(difficulty)),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(breakClock(current)).toEqual(
            Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
          )
        }),
        ...ticks(BREAK_TICKS * 3, TICK_MS),
        Story.model(current => {
          expect(isBreak(current)).toBe(true)
        }),
        tap('Enter'),
        Story.model(current => {
          expect(isFighting(current)).toBe(true)
        }),
      ),
  )

  it.effect.each(['Hard', 'Nightmare'] as const)(
    '%s keeps the countdown, which starts the wave on its own',
    difficulty =>
      Story.story(
        APPLICATION,
        Story.given(clearingLaterWave(difficulty)),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(breakClock(current)).toEqual(
            Option.some(BreakClock.Counting()),
          )
        }),
        ...ticks(BREAK_TICKS, TICK_MS),
        Story.model(current => {
          expect(isFighting(current)).toBe(true)
        }),
      ),
  )
})

describe('the new zombie card', () => {
  const carded: Model = modifyFields(home, {
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
  })

  it.effect('stays up 5.5 seconds and cannot be skipped in its first 1.5', () =>
    Effect.gen(function* () {
      expect(DEBUT_CARD_MS).toBe(5500)
      expect(DEBUT_CARD_MIN_MS).toBe(1500)
      yield* Story.story(
        APPLICATION,
        Story.given(carded),
        ...ticks(DEBUT_CARD_MIN_MS / TICK_MS - 1, TICK_MS),
        tap('Enter'),
        Story.message(Message.ClickedDebutCardButton()),
        Story.model(current => {
          expect(current.debutCard._tag).toBe('Showing')
          expect(focusOf(current).player.x).toBe(focusOf(home).player.x)
        }),
        tick(TICK_MS),
        tap('Enter'),
        Story.model(current => {
          expect(current.debutCard).toEqual(DebutCard.Hidden())
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(carded),
        ...ticks(DEBUT_CARD_MS / TICK_MS - 1, TICK_MS),
        Story.model(current => {
          expect(current.debutCard._tag).toBe('Showing')
        }),
        tick(TICK_MS),
        Story.model(current => {
          expect(current.debutCard).toEqual(DebutCard.Hidden())
        }),
      )
    }),
  )
})

describe('gun slots on touch', () => {
  const carrying: Model = modifyFocus(
    modifyFields(home, {
      lastDevice: () => 'Touch',
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
    }),
    {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            Arsenal.HoldingFirst({
              first: { ...STARTING_PISTOL, loaded: 2 },
              second: { kind: 'Smg', loaded: 30, tier: 0, kills: 0 },
            }),
        }),
    },
  )

  it.effect('a tap on the held gun reloads it, a tap on the other swaps', () =>
    Story.story(
      APPLICATION,
      Story.given(carrying),
      Story.message(Message.ClickedGunSlot({ slot: 'First' })),
      Story.model(current => {
        expect(
          Reload.isAnyOf(['Reloading'])(focusOf(current).player.reload),
        ).toBe(true)
        expect(focusOf(current).player.arsenal._tag).toBe('HoldingFirst')
      }),
      Story.message(Message.ClickedGunSlot({ slot: 'Second' })),
      Story.model(current => {
        expect(focusOf(current).player.arsenal._tag).toBe('HoldingSecond')
        expect(Reload.isAnyOf(['Ready'])(focusOf(current).player.reload)).toBe(
          true,
        )
      }),
    ),
  )
})

describe('full screen', () => {
  it.effect(
    'the button asks for full screen, and a refusal changes nothing',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(initialModel, { screenFit: () => 'Fullscreen' }),
        ),
        Story.message(Message.ClickedFullscreenButton()),
        Story.Command.expectExact(SetFullscreen({ fullscreen: 'On' })),
        Story.Command.resolve(
          SetFullscreen,
          Message.FailedSetFullscreen({ reason: 'Permission denied' }),
        ),
        Story.model(current => {
          expect(current.fullscreen).toBe('Off')
        }),
        Story.message(Message.ClickedFullscreenButton()),
        Story.Command.resolve(
          SetFullscreen,
          Message.CompletedSetFullscreen({ fullscreen: 'On' }),
        ),
        Story.model(current => {
          expect(current.fullscreen).toBe('On')
        }),
        Story.message(Message.ClickedFullscreenButton()),
        Story.Command.expectExact(SetFullscreen({ fullscreen: 'Off' })),
        Story.Command.resolve(
          SetFullscreen,
          Message.CompletedSetFullscreen({ fullscreen: 'Off' }),
        ),
        Story.message(Message.ChangedFullscreen({ fullscreen: 'On' })),
        Story.model(current => {
          expect(current.fullscreen).toBe('On')
        }),
      ),
  )
})

describe('the install tile', () => {
  it.effect(
    'on Chrome, a tap shows the browser install prompt and stops the pulse',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(initialModel, { screenFit: () => 'Fullscreen' }),
        ),
        Story.message(Message.ChangedInstallOffer({ installOffer: 'Ready' })),
        Story.model(current => {
          expect(current.homeScreenTip).toBe('Unseen')
        }),
        Story.message(Message.ClickedInstallButton()),
        Story.Command.expectExact(ShowInstallPrompt),
        Story.model(current => {
          expect(current.homeScreenTip).toBe('Dismissed')
          expect(current.homeScreenSteps.isOpen).toBe(false)
        }),
        Story.Command.resolve(
          ShowInstallPrompt,
          Message.CompletedShowInstallPrompt({ outcome: 'Accepted' }),
        ),
        Story.model(current => {
          expect(current.installOffer).toBe('Installed')
        }),
      ),
  )

  it.effect(
    'a turned down prompt is spent, and the tile goes until Chrome offers again',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(initialModel, { installOffer: () => 'Ready' }),
        ),
        Story.message(Message.ClickedInstallButton()),
        Story.Command.resolve(
          ShowInstallPrompt,
          Message.CompletedShowInstallPrompt({ outcome: 'Dismissed' }),
        ),
        Story.model(current => {
          expect(current.installOffer).toBe('None')
        }),
        Story.message(Message.ClickedInstallButton()),
        Story.Command.expectNone(),
      ),
  )

  it.effect('on an iPhone, a tap opens the picture guide', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(initialModel, { screenFit: () => 'HomeScreen' }),
      ),
      Story.message(Message.ClickedInstallButton()),
      Story.model(current => {
        expect(current.homeScreenSteps.isOpen).toBe(true)
        expect(current.homeScreenTip).toBe('Dismissed')
      }),
      showDialog(),
    ),
  )

  it.effect('the pulse outlives a run until the tile is used', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(initialModel, {
          screenFit: () => 'HomeScreen',
          difficultyCard: () => DifficultyCard.Seen(),
        }),
      ),
      tap('Enter'),
      Story.model(current => {
        expect(current.homeScreenTip).toBe('Unseen')
      }),
    ),
  )

  it.effect(
    'the installed Home Screen app is told apart from the browser',
    () =>
      Story.story(
        APPLICATION,
        Story.given(initialModel),
        Story.message(
          Message.CompletedDetectScreenFit({ screenFit: 'Installed' }),
        ),
        Story.model(current => {
          expect(current.screenFit).toBe('Installed')
        }),
      ),
  )
})
