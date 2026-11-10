import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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
import { PREPARATION_MS } from '../../../shared/constants'
import { APPLICATION, measureSurface } from '../../../test/testing'
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
  firstBreakQuest: () => QuestTour.Running(),
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
      Scene.expect(Scene.role('listitem', { name: 'Take the trap' })).toExist(),
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
