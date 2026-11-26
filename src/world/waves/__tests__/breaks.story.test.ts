import { Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
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
  checkModel,
  modelAfter,
  send,
  steps,
  tap,
  tick,
  ticks,
} from '../../../test/testing'
import { STARTING_PISTOL } from '../../gear/weapons'
import { focusOf, modifyFocus } from '../../party/party'
import { breakMsOf } from '../../run/difficulty'
import { Arsenal } from '../../schema/worldSchema'

const TICK_MS = 50
// NOTE: a 50 ms frame is three 60 Hz ticks; the moment a wave clears is
// checked after a single tick, before the break's clock has run.

const clearingWave = (wave: number): Model =>
  UiStruct.evolve(home, {
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
    LeftEarly: () => Option.none(),
    GameOver: () => Option.none(),
  })

const breakDurationMs = (current: Model): Option.Option<number> =>
  Phase.match(current.phase, {
    Ready: () => Option.none(),
    Arriving: () => Option.none(),
    Preparation: ({ durationMs }) => Option.some(durationMs),
    Wave: () => Option.none(),
    Paused: () => Option.none(),
    Escaped: () => Option.none(),
    LeftEarly: () => Option.none(),
    GameOver: () => Option.none(),
  })

const clearingLaterWave = (difficulty: Difficulty): Model =>
  UiStruct.evolve(pastTimedBreaks(clearingWave(4)), {
    difficulty: setting =>
      UiStruct.evolve(setting, { chosen: () => difficulty }),
  })

const BREAK_TICKS = Math.ceil(PREPARATION_MS / TICK_MS) + 10

describe('the first break waits', () => {
  it.effect(
    'the break before wave 2 has no countdown and waits for START WAVE',
    () =>
      modelAfter(
        clearingWave(1),
        steps(
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(isBreak(current)).toBe(true)
            expect(breakClock(current)).toEqual(
              Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
            )
          }),
          ticks(BREAK_TICKS, TICK_MS),
          checkModel(current => {
            expect(isBreak(current)).toBe(true)
            expect(shownHints(current)).toEqual([])
            expect(isCountdownBeckoning(current)).toBe(false)
          }),
          tap('Enter'),
          checkModel(current => {
            expect(isFighting(current)).toBe(true)
          }),
        ),
      ),
  )

  it.effect(
    'the break before wave 3 counts down once the fridge is tried, with the heads-up shown once',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          onHard(
            UiStruct.evolve(clearingWave(2), {
              fridge: fridge => UiStruct.evolve(fridge, { pulls: () => 1 }),
            }),
          ),
          steps(
            tick(TICK_MS),
            checkModel(current => {
              expect(breakClock(current)).toEqual(
                Option.some(BreakClock.Counting()),
              )
              expect(isCountdownBeckoning(current)).toBe(true)
            }),
            ticks(BREAK_TICKS, TICK_MS),
            checkModel(current => {
              expect(isFighting(current)).toBe(true)
              expect(current.lessons.timedBreaks._tag).toBe('Learned')
            }),
          ),
        )
        yield* modelAfter(
          UiStruct.evolve(clearingWave(3), {
            lessons: lessons =>
              UiStruct.evolve(lessons, {
                timedBreaks: () => Lesson.Learned({ atMs: 0 }),
              }),
          }),
          steps(
            tick(TICK_MS),
            checkModel(afterHeadsUp => {
              expect(isBreak(afterHeadsUp)).toBe(true)
              expect(isCountdownBeckoning(afterHeadsUp)).toBe(false)
            }),
          ),
        )
      }),
  )

  it.effect('endless keeps the same rule', () =>
    modelAfter(
      UiStruct.evolve(clearingWave(1), {
        mode: () => RunMode.Endless(),
      }),
      steps(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(breakClock(current)).toEqual(
            Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
          )
        }),
      ),
    ),
  )
})

// NOTE: owner, 2026-11-10: with the shop gone every break counts down,
// Normal too (2026-11-01 had none below Hard), and 2026-11-12 takes the
// clock off Easy again. READY still starts the wave early. Running out is
// the same countdown on every difficulty, so only the 20 s ones are played
// through.
describe('the break clock by difficulty', () => {
  it.effect('Easy has no countdown, and the wave waits for READY', () =>
    modelAfter(
      clearingLaterWave('Easy'),
      steps(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(breakClock(current)).toEqual(
            Option.some(BreakClock.Waiting({ elapsedMs: 0 })),
          )
        }),
        ticks(BREAK_TICKS * 2, TICK_MS),
        checkModel(current => {
          expect(isBreak(current)).toBe(true)
        }),
        tap('Enter'),
        checkModel(current => {
          expect(isFighting(current)).toBe(true)
        }),
      ),
    ),
  )

  it.effect.each([60, 30, 20])(
    'Easy counts down the %s s the lobby picked',
    seconds =>
      modelAfter(
        UiStruct.evolve(clearingLaterWave('Easy'), {
          easyBreakSeconds: () => seconds,
        }),
        steps(
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(breakClock(current)).toEqual(
              Option.some(BreakClock.Counting()),
            )
            expect(breakDurationMs(current)).toEqual(
              Option.some(seconds * 1000),
            )
          }),
        ),
      ),
  )

  it.effect.each([
    { difficulty: 'Normal', breakMs: 30_000 },
    { difficulty: 'Hard', breakMs: PREPARATION_MS },
    { difficulty: 'Nightmare', breakMs: PREPARATION_MS },
  ] as const)(
    '$difficulty counts down $breakMs ms, and READY starts it early',
    ({ difficulty, breakMs }) =>
      modelAfter(
        clearingLaterWave(difficulty),
        steps(
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(breakClock(current)).toEqual(
              Option.some(BreakClock.Counting()),
            )
            expect(breakMsOf(difficulty)).toBe(breakMs)
            expect(breakDurationMs(current)).toEqual(Option.some(breakMs))
          }),
          tap('Enter'),
          checkModel(current => {
            expect(isFighting(current)).toBe(true)
          }),
        ),
      ),
  )

  it.effect.each(['Hard', 'Nightmare'] as const)(
    '%s starts the wave on its own when the clock runs out',
    difficulty =>
      modelAfter(
        clearingLaterWave(difficulty),
        steps(
          tick(FIXED_STEP_MS),
          ticks(BREAK_TICKS, TICK_MS),
          checkModel(current => {
            expect(isFighting(current)).toBe(true)
          }),
        ),
      ),
  )
})

describe('the new zombie card', () => {
  const carded: Model = UiStruct.evolve(home, {
    phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
    debutCard: () => DebutCard.Showing({ kind: 'Runner', ageMs: 0 }),
  })

  it.effect('stays up 5.5 seconds and cannot be skipped in its first 1.5', () =>
    Effect.gen(function* () {
      expect(DEBUT_CARD_MS).toBe(5500)
      expect(DEBUT_CARD_MIN_MS).toBe(1500)
      yield* modelAfter(
        carded,
        steps(
          ticks(DEBUT_CARD_MIN_MS / TICK_MS - 1, TICK_MS),
          tap('Enter'),
          send(Message.ClickedDebutCardButton()),
          checkModel(current => {
            expect(current.debutCard._tag).toBe('Showing')
            expect(focusOf(current).player.x).toBe(focusOf(home).player.x)
          }),
          tick(TICK_MS),
          tap('Enter'),
          checkModel(current => {
            expect(current.debutCard).toEqual(DebutCard.Hidden())
          }),
        ),
      )
      yield* modelAfter(
        carded,
        steps(
          ticks(DEBUT_CARD_MS / TICK_MS - 1, TICK_MS),
          checkModel(current => {
            expect(current.debutCard._tag).toBe('Showing')
          }),
          tick(TICK_MS),
          checkModel(current => {
            expect(current.debutCard).toEqual(DebutCard.Hidden())
          }),
        ),
      )
    }),
  )
})

describe('gun slots on touch', () => {
  const carrying: Model = modifyFocus(
    UiStruct.evolve(home, {
      lastDevice: () => 'Touch',
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          arsenal: () =>
            Arsenal.HoldingFirst({
              first: { ...STARTING_PISTOL, loaded: 2 },
              second: { kind: 'Smg', loaded: 30, tier: 0, kills: 0 },
            }),
        }),
    },
  )

  it.effect('a tap on the held gun reloads it, a tap on the other swaps', () =>
    modelAfter(
      carrying,
      steps(
        send(Message.ClickedGunSlot({ slot: 'First' })),
        checkModel(current => {
          expect(
            Reload.isAnyOf(['Reloading'])(focusOf(current).player.reload),
          ).toBe(true)
          expect(focusOf(current).player.arsenal._tag).toBe('HoldingFirst')
        }),
        send(Message.ClickedGunSlot({ slot: 'Second' })),
        checkModel(current => {
          expect(focusOf(current).player.arsenal._tag).toBe('HoldingSecond')
          expect(
            Reload.isAnyOf(['Ready'])(focusOf(current).player.reload),
          ).toBe(true)
        }),
      ),
    ),
  )
})

describe('full screen', () => {
  it.effect(
    'the button asks for full screen, and a refusal changes nothing',
    () =>
      modelAfter(
        UiStruct.evolve(initialModel, {
          settings: UiStruct.evolve({ screenFit: () => 'Fullscreen' }),
        }),
        steps(
          send(Message.ClickedFullscreenButton()),
          s => s.expectExact(SetFullscreen.make({ fullscreen: 'On' })),
          s => s.resolve(SetFullscreen, Component.noop),
          checkModel(current => {
            expect(current.settings.fullscreen).toBe('Off')
          }),
          send(Message.ClickedFullscreenButton()),
          s =>
            s.resolve(
              SetFullscreen,
              Message.CompletedSetFullscreen({ fullscreen: 'On' }),
            ),
          checkModel(current => {
            expect(current.settings.fullscreen).toBe('On')
          }),
          send(Message.ClickedFullscreenButton()),
          s => s.expectExact(SetFullscreen.make({ fullscreen: 'Off' })),
          s =>
            s.resolve(
              SetFullscreen,
              Message.CompletedSetFullscreen({ fullscreen: 'Off' }),
            ),
          send(Message.ChangedFullscreen({ fullscreen: 'On' })),
          checkModel(current => {
            expect(current.settings.fullscreen).toBe('On')
          }),
        ),
      ),
  )
})

describe('the install tile', () => {
  it.effect(
    'on Chrome, a tap shows the browser install prompt and stops the pulse',
    () =>
      modelAfter(
        UiStruct.evolve(initialModel, {
          settings: UiStruct.evolve({ screenFit: () => 'Fullscreen' }),
        }),
        steps(
          send(Message.ChangedInstallOffer({ installOffer: 'Ready' })),
          checkModel(current => {
            expect(current.homeScreenTip).toBe('Unseen')
          }),
          send(Message.ClickedInstallButton()),
          s => s.expectExact(ShowInstallPrompt.make()),
          checkModel(current => {
            expect(current.homeScreenTip).toBe('Dismissed')
            expect(current.homeScreenSteps.isOpen).toBe(false)
          }),
          s =>
            s.resolve(
              ShowInstallPrompt,
              Message.CompletedShowInstallPrompt({ outcome: 'Accepted' }),
            ),
          checkModel(current => {
            expect(current.release.installOffer).toBe('Installed')
          }),
        ),
      ),
  )

  it.effect(
    'a turned down prompt is spent, and the tile goes until Chrome offers again',
    () =>
      modelAfter(
        UiStruct.evolve(initialModel, {
          release: UiStruct.evolve({ installOffer: () => 'Ready' }),
        }),
        steps(
          send(Message.ClickedInstallButton()),
          s =>
            s.resolve(
              ShowInstallPrompt,
              Message.CompletedShowInstallPrompt({ outcome: 'Dismissed' }),
            ),
          checkModel(current => {
            expect(current.release.installOffer).toBe('None')
          }),
          send(Message.ClickedInstallButton()),
          s => s.expectNone(),
        ),
      ),
  )

  it.effect('on an iPhone, a tap opens the picture guide', () =>
    modelAfter(
      UiStruct.evolve(initialModel, {
        settings: UiStruct.evolve({ screenFit: () => 'HomeScreen' }),
      }),
      steps(
        send(Message.ClickedInstallButton()),
        checkModel(current => {
          expect(current.homeScreenSteps.isOpen).toBe(true)
          expect(current.homeScreenTip).toBe('Dismissed')
        }),
      ),
    ),
  )

  it.effect('the pulse outlives a run until the tile is used', () =>
    modelAfter(
      UiStruct.evolve(initialModel, {
        difficultyCard: () => DifficultyCard.Seen(),
        settings: UiStruct.evolve({ screenFit: () => 'HomeScreen' }),
      }),
      steps(
        tap('Enter'),
        checkModel(current => {
          expect(current.homeScreenTip).toBe('Unseen')
        }),
      ),
    ),
  )

  it.effect(
    'the installed Home Screen app is told apart from the browser',
    () =>
      modelAfter(
        initialModel,
        steps(
          send(Message.CompletedDetectScreenFit({ screenFit: 'Installed' })),
          checkModel(current => {
            expect(current.settings.screenFit).toBe('Installed')
          }),
        ),
      ),
  )
})
