import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { describe, it } from '@effect/vitest'

import {
  BreakClock,
  Lesson,
  type Model,
  Phase,
  QuestTour,
  Tour,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { FIXED_STEP_MS, PREPARATION_MS } from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  ackHudSlots,
  byClass,
  emitFrame,
  emitPressedKey,
  expectAttr,
  measureHud,
} from '../../../test/sceneTesting'
import {
  type SceneStep,
  sceneOf,
  settleRunCommands,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'

const questBreak: Model = UiStruct.evolve(asVeteran(initialModel), {
  phase: () =>
    Phase.Preparation({
      wave: 2,
      remainingMs: PREPARATION_MS,
      durationMs: PREPARATION_MS,
      spawns: [],
      clock: BreakClock.Waiting({ elapsedMs: 0 }),
    }),
  lessons: lessons =>
    UiStruct.evolve(lessons, {
      dareTour: () => Lesson.Pending(),
      dareKey: () => Lesson.Pending(),
    }),
  firstBreakQuest: () => QuestTour.Running({ isLockSeen: false }),
})

const role = HtmlLocator.role

const tracker = role('region', { name: 'First break' })

const listItem = (name: string) => role('listitem', { name })

describe('the first break tracker', () => {
  it.effect('shows the step at hand and skips on a tap', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(questBreak)
      s.pipe(measureHud)
        .expect(tracker)
        .toExist()
        .expect(listItem('Grab the key, now'))
        .toExist()
        .expect(listItem('Find a padlock for keys'))
        .toExist()
        .expect(listItem('Open the case'))
        .toExist()
        .expect(listItem('Look at the dare card'))
        .toExist()
        .click(role('button', { name: 'Skip the first break tour' }))
        .pipe(settleRunCommands)
        .expect(tracker)
        .toBeAbsent()
    }),
  )

  it.effect('on the last step it lights the dare card word', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(questBreak, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      )
      s.pipe(measureHud)
        .expect(listItem('Open the case, done'))
        .toExist()
        .expect(listItem('Look at the dare card, now'))
        .toExist()
    }),
  )

  it.effect('done, every step is ticked and the skip button goes', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(questBreak, {
          firstBreakQuest: () => QuestTour.Done({ ageMs: 0 }),
        }),
      )
      s.pipe(measureHud)
        .expect(listItem('Look at the dare card, done'))
        .toExist()
        .expect(role('button', { name: 'Skip the first break tour' }))
        .toBeAbsent()
    }),
  )
})

// NOTE: the last step: START WAVE glows, an arrow bobs over it (the key's
// cap beside it on a keyboard), and starting the wave by a tap or the key
// ticks the step off in the tracker as the wave begins.
describe('the START WAVE step', () => {
  // NOTE: a wave with a zombie to come, so it does not clear at once.
  const onStart = (device: Model['lastDevice']): Model =>
    UiStruct.evolve(questBreak, {
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: PREPARATION_MS,
          durationMs: PREPARATION_MS,
          spawns: [DISTANT_SPAWN],
          clock: BreakClock.Waiting({ elapsedMs: 0 }),
        }),
      firstBreakQuest: () => QuestTour.Starting(),
      lastDevice: () => device,
    })

  // NOTE: a frame of the wave just started: the HUD's slots, mounted anew,
  // acknowledged first, and its sounds and cues played.
  const frame: SceneStep = s =>
    s.pipe(
      ackHudSlots,
      settleRunCommands,
      emitFrame(FIXED_STEP_MS),
      settleRunCommands,
    )

  const startButton = role('button', { name: 'Start wave 2 now' })

  it.effect('a touch tap on the glowing pill ticks it off', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onStart('Touch'))
      s.pipe(measureHud, expectAttr(startButton, 'data-tour', 'true'))
        .expect(listItem('Start the wave, now'))
        .toExist()
        .expect(byClass('start-wave-point-arrow'))
        .toExist()
        .expect(byClass('start-wave-point-key'))
        .toBeAbsent()
        .click(startButton)
        .pipe(frame)
        .expect(startButton)
        .toBeAbsent()
        .expect(byClass('start-wave-point'))
        .toBeAbsent()
        .expect(listItem('Start the wave, done'))
        .toExist()
    }),
  )

  it.effect('on a keyboard it shows the key, and the key ticks it off', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(onStart('KeyboardMouse'))
      s.pipe(measureHud, expectAttr(startButton, 'data-tour', 'true'))
        .expect(byClass('start-wave-point-key'))
        .toHaveText('ENTER')
        .pipe(emitPressedKey('Enter'), frame)
        .expect(startButton)
        .toBeAbsent()
        .expect(listItem('Start the wave, done'))
        .toExist()
    }),
  )

  it.effect('before the last step, START WAVE has no arrow', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(
        UiStruct.evolve(questBreak, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      )
      s.pipe(measureHud, expectAttr(startButton, 'data-tour', 'false'))
        .expect(byClass('start-wave-point'))
        .toBeAbsent()
    }),
  )
})

describe('the kitchen tour tracker', () => {
  it.effect(
    'shows the held clock and the boards step, and skips on a tap',
    () =>
      Effect.gen(function* () {
        const kitchenTour = role('region', { name: 'Kitchen tour' })
        const s = yield* sceneOf(
          UiStruct.evolve(asVeteran(initialModel), {
            phase: () =>
              Phase.Preparation({
                clock: BreakClock.Counting(),
                wave: 3,
                remainingMs: PREPARATION_MS,
                durationMs: PREPARATION_MS,
                spawns: [],
              }),
            kitchenTour: () => Tour.Running(),
          }),
        )
        s.pipe(measureHud, expectAttr(kitchenTour, 'data-side', 'Right'))
          .expect(kitchenTour)
          .toExist()
          .expect(role('img', { name: 'The break clock waits' }))
          .toExist()
          .expect(listItem('Open the kitchen, free, now'))
          .toExist()
          .click(role('button', { name: 'Skip the kitchen tour' }))
          .pipe(settleRunCommands)
          .expect(kitchenTour)
          .toBeAbsent()
      }),
  )
})
