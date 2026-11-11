import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import { Message } from '../../../app/message'
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
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  emitPressedKey,
  measureSurface,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'

const questBreak: Model = modifyFields(asVeteran(initialModel), {
  phase: () =>
    Phase.Preparation({
      wave: 2,
      remainingMs: PREPARATION_MS,
      durationMs: PREPARATION_MS,
      spawns: [],
      clock: BreakClock.Waiting({ elapsedMs: 0 }),
    }),
  lessons: lessons =>
    modifyFields(lessons, {
      dareTour: () => Lesson.Pending(),
      dareKey: () => Lesson.Pending(),
    }),
  firstBreakQuest: () => QuestTour.Running({ isLockSeen: false }),
})

const tracker = Scene.role('region', { name: 'First break' })

describe('the first break tracker', () => {
  it.effect('shows the step at hand and skips on a tap', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(questBreak),
      measureSurface,
      Scene.expect(tracker).toExist(),
      Scene.expect(
        Scene.role('listitem', { name: 'Grab the key, now' }),
      ).toExist(),
      Scene.expect(
        Scene.role('listitem', { name: 'Find a padlock for keys' }),
      ).toExist(),
      Scene.expect(Scene.role('listitem', { name: 'Open the case' })).toExist(),
      Scene.expect(
        Scene.role('listitem', { name: 'Look at the dare card' }),
      ).toExist(),
      Scene.click(Scene.role('button', { name: 'Skip the first break tour' })),
      Scene.expect(tracker).toBeAbsent(),
    ),
  )

  it.effect('on the last step it lights the dare card word', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(questBreak, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      ),
      measureSurface,
      Scene.expect(
        Scene.role('listitem', { name: 'Open the case, done' }),
      ).toExist(),
      Scene.expect(
        Scene.role('listitem', { name: 'Look at the dare card, now' }),
      ).toExist(),
    ),
  )

  it.effect('done, every step is ticked and the skip button goes', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(questBreak, {
          firstBreakQuest: () => QuestTour.Done({ ageMs: 0 }),
        }),
      ),
      measureSurface,
      Scene.expect(
        Scene.role('listitem', { name: 'Look at the dare card, done' }),
      ).toExist(),
      Scene.expect(
        Scene.role('button', { name: 'Skip the first break tour' }),
      ).toBeAbsent(),
    ),
  )
})

// NOTE: the last step: START WAVE glows, an arrow bobs over it (the key's
// cap beside it on a keyboard), and starting the wave by a tap or the key
// ticks the step off in the tracker as the wave begins.
describe('the START WAVE step', () => {
  // NOTE: a wave with a zombie to come, so it does not clear at once.
  const onStart = (device: Model['lastDevice']): Model =>
    modifyFields(questBreak, {
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

  const frame = Scene.Subscription.emit(
    SCENE_SUBSCRIPTIONS.frame,
    Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
  )

  const startButton = Scene.role('button', { name: 'Start wave 2 now' })

  it.effect('a touch tap on the glowing pill ticks it off', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onStart('Touch')),
      measureSurface,
      Scene.expect(
        Scene.role('listitem', { name: 'Start the wave, now' }),
      ).toExist(),
      Scene.expect(startButton).toHaveAttr('data-tour', 'true'),
      Scene.expect(Scene.selector('.start-wave-point-arrow')).toExist(),
      Scene.expect(Scene.selector('.start-wave-point-key')).toBeAbsent(),
      Scene.click(startButton),
      frame,
      Scene.expect(startButton).toBeAbsent(),
      Scene.expect(Scene.selector('.start-wave-point')).toBeAbsent(),
      Scene.expect(
        Scene.role('listitem', { name: 'Start the wave, done' }),
      ).toExist(),
    ),
  )

  it.effect('on a keyboard it shows the key, and the key ticks it off', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(onStart('KeyboardMouse')),
      measureSurface,
      Scene.expect(startButton).toHaveAttr('data-tour', 'true'),
      Scene.expect(Scene.selector('.start-wave-point-key')).toHaveText('ENTER'),
      emitPressedKey('Enter'),
      frame,
      Scene.expect(startButton).toBeAbsent(),
      Scene.expect(
        Scene.role('listitem', { name: 'Start the wave, done' }),
      ).toExist(),
    ),
  )

  it.effect('before the last step, START WAVE has no arrow', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFields(questBreak, {
          firstBreakQuest: () => QuestTour.Looking({ ageMs: 0 }),
        }),
      ),
      measureSurface,
      Scene.expect(startButton).toHaveAttr('data-tour', 'false'),
      Scene.expect(Scene.selector('.start-wave-point')).toBeAbsent(),
    ),
  )
})

describe('the kitchen tour tracker', () => {
  it.effect(
    'shows the held clock and the boards step, and skips on a tap',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(asVeteran(initialModel), {
            phase: () =>
              Phase.Preparation({
                wave: 3,
                remainingMs: PREPARATION_MS,
                durationMs: PREPARATION_MS,
                spawns: [],
              }),
            kitchenTour: () => Tour.Running(),
          }),
        ),
        measureSurface,
        Scene.expect(Scene.role('region', { name: 'Kitchen tour' })).toExist(),
        Scene.expect(Scene.role('region', { name: 'Kitchen tour' })).toHaveAttr(
          'data-side',
          'Right',
        ),
        Scene.expect(
          Scene.role('img', { name: 'The break clock waits' }),
        ).toExist(),
        Scene.expect(
          Scene.role('listitem', { name: 'Open the kitchen, free, now' }),
        ).toExist(),
        Scene.click(Scene.role('button', { name: 'Skip the kitchen tour' })),
        Scene.expect(
          Scene.role('region', { name: 'Kitchen tour' }),
        ).toBeAbsent(),
      ),
  )
})
