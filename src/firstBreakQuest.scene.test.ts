import { click, expect, given, role, scene } from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test } from 'vitest'

import { PREPARATION_MS } from './constants'
import { BreakClock, type Model, Phase, Tour } from './model'
import { initialModel } from './pureApp'
import { ROOT, measureSurface } from './testing'
import { asVeteran } from './veteran'

const questBreak: Model = modifyFields(asVeteran(initialModel), {
  phase: () =>
    Phase.Preparation({
      wave: 2,
      remainingMs: PREPARATION_MS,
      durationMs: PREPARATION_MS,
      spawns: [],
      clock: BreakClock.Waiting({ elapsedMs: 0 }),
    }),
  firstBreakQuest: () => Tour.Running(),
})

const tracker = role('region', { name: 'First break' })

describe('the first break tracker', () => {
  test('shows the step at hand and skips on a tap', () => {
    scene(
      ROOT,
      given(questBreak),
      measureSurface,
      expect(tracker).toExist(),
      expect(
        role('listitem', { name: "Walk to Rattles' stall, now" }),
      ).toExist(),
      expect(role('listitem', { name: 'Buy a Plank Pile' })).toExist(),
      click(role('button', { name: 'Skip the first break tour' })),
      expect(tracker).toBeAbsent(),
    )
  })

  test('done, every step is ticked and the skip button goes', () => {
    scene(
      ROOT,
      given(
        modifyFields(questBreak, {
          firstBreakQuest: () => Tour.Done({ ageMs: 0 }),
        }),
      ),
      measureSurface,
      expect(role('listitem', { name: 'Put it in a doorway, done' })).toExist(),
      expect(
        role('button', { name: 'Skip the first break tour' }),
      ).toBeAbsent(),
    )
  })
})

describe('the kitchen tour tracker', () => {
  test('shows the held clock and the boards step, and skips on a tap', () => {
    scene(
      ROOT,
      given(
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
      expect(role('region', { name: 'Kitchen tour' })).toExist(),
      expect(role('region', { name: 'Kitchen tour' })).toHaveAttr(
        'data-side',
        'Right',
      ),
      expect(role('img', { name: 'The break clock waits' })).toExist(),
      expect(
        role('listitem', { name: 'Open the kitchen, free, now' }),
      ).toExist(),
      click(role('button', { name: 'Skip the kitchen tour' })),
      expect(role('region', { name: 'Kitchen tour' })).toBeAbsent(),
    )
  })
})
